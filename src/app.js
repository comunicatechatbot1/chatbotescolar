import 'dotenv/config'
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import googleService from './googleService.js'
import groqService from './ai-chat.js'
import chatHistoryService from './chat-history.js'
import scheduledMessagesService from './scheduled-messages.js'


const PORT = process.env.PORT ?? 3010

const dynamicFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic }) => {
        const phoneNumber = ctx.from
        const userInput = ctx.body.toLowerCase().trim()
        console.log('📩 Mensaje recibido:', userInput)

        // 0. VERIFICAR BLACKLIST (si está bloqueado, no responder nada)
        try {
            console.log('🔒 Verificando blacklist para:', phoneNumber)
            const blacklist = await googleService.getBlacklist()
            console.log('🔒 Números en blacklist:', JSON.stringify(blacklist))
            const isBlocked = await googleService.isBlacklisted(phoneNumber)
            console.log('🔒 ¿Está bloqueado?:', isBlocked)
            if (isBlocked) {
                console.log('🚫 Número bloqueado, ignorando mensaje:', phoneNumber)
                return // Terminar ejecución, no responder nada
            }
        } catch (blacklistError) {
            console.error('⚠️ Error al verificar blacklist:', blacklistError)
        }


        // NOTA: Módulo de bienvenida eliminado. La IA maneja la conversación desde el inicio.
        // 2. Flujos normales
        const flows = await googleService.getFlows()

        // 1) Priorizar comandos de citas antes de flujos de Sheets
        const isAppointmentIntent = (
            userInput.includes('agendar') ||
            userInput.includes('agenda') ||
            userInput.includes('reserv') ||
            userInput.includes('cita') ||
            userInput.includes('entrenamiento') ||
            userInput.includes('sesión') ||
            userInput.includes('sesion') ||
            userInput.includes('horarios disponibles') ||
            userInput.includes('mis citas') ||
            userInput.includes('cancelar cita')
        )
        console.log('🔎 Intención cita:', isAppointmentIntent)
        if (isAppointmentIntent) {
            console.log('📅 Intento de cita detectado, procesando con IA/Calendar')
            const aiResponse = await groqService.getResponse(userInput, phoneNumber)
            return await flowDynamic(aiResponse)
        }

        // 2) Flujos de Sheets
        const triggeredFlow = flows.find(f => {
            if (!f.addKeyword) return false
            const sheetKeyword = String(f.addKeyword).toLowerCase().trim()
            return sheetKeyword && userInput.includes(sheetKeyword)
        })

        if (triggeredFlow) {
            console.log('🧭 Flujo disparado desde Sheets:', triggeredFlow.addKeyword)
            const answer = (triggeredFlow.addAnswer || '').trim()
            const mediaUrl = triggeredFlow.media && triggeredFlow.media.trim()
            await chatHistoryService.saveMessage(phoneNumber, 'user', userInput)
            if (!answer) {
                console.log('⚠️ Flujo sin respuesta (addAnswer vacío). Derivando a IA')
                const aiResponse = await groqService.getResponse(userInput, phoneNumber)
                return await flowDynamic(aiResponse)
            }
            await chatHistoryService.saveMessage(phoneNumber, 'assistant', answer)
            if (mediaUrl) {
                return await flowDynamic(answer, { media: mediaUrl })
            } else {
                return await flowDynamic(answer)
            }
        }

        // 3) Fallback: IA
        console.log('🤖 No se encontró palabra clave, derivando a la IA...')
        const aiResponse = await groqService.getResponse(userInput, phoneNumber)
        return await flowDynamic(aiResponse)
    })

const main = async () => {
    await googleService.getFlows()
    await googleService.getPrompts()
    // Hoja Instructores eliminada - se usa Docentes
    await googleService.ensureAppointmentsSheet()
    // Hoja Bienvenida eliminada - La IA maneja la conversación desde el inicio
    await googleService.ensureBlacklistSheet()
    await googleService.ensureStudentsSheet()
    await googleService.ensureDocentesSheet()
    await googleService.ensureFormConfigSheet()
    await googleService.ensureEnviosSheet()
    const calendarOk = await googleService.verifyCalendarAccess()
    if (!calendarOk) {
        console.log('⚠️ Verificar CALENDAR_ID en .env y compartir el calendario con el Service Account como Editor')
    }

    setInterval(async () => {
        console.log('🧹 Iniciando limpieza automática del historial...')
        const deletedCount = await chatHistoryService.cleanOldHistories()
        console.log(`🧹 Limpieza completada. Archivos eliminados: ${deletedCount}`)
    }, 24 * 60 * 60 * 1000)

    const stats = await chatHistoryService.getStats()
    console.log('📊 Estadísticas del historial:', stats)



    const adapterFlow = createFlow([dynamicFlow])
    const adapterProvider = createProvider(Provider, { version: [2, 3000, 1029030078] })
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    // Iniciar scheduler de mensajes programados
    scheduledMessagesService.startScheduler(adapterProvider)



    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )



    httpServer(+PORT)
}

main()
