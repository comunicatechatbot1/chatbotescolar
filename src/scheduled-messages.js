import googleService from './googleService.js'

/**
 * Módulo de Mensajes Programados
 * Envía mensajes según la hoja 'Envios' cuando se cumple la fecha/hora
 * Incluye protecciones anti-bloqueo
 */

class ScheduledMessagesService {
    constructor() {
        this.isProcessing = false
        this.dailySentCount = 0
        this.lastResetDate = new Date().toDateString()

        // Configuración anti-bloqueo
        this.config = {
            minDelayMs: 5000,      // 5 segundos mínimo entre mensajes
            maxDelayMs: 15000,     // 15 segundos máximo entre mensajes
            maxDailyMessages: 50,  // Límite diario
            checkIntervalMs: 60000, // Verificar cada 1 minuto
            startHour: 6,          // Hora inicio (6am)
            endHour: 21            // Hora fin (9pm)
        }
    }

    /**
     * Obtiene mensajes programados desde la hoja 'Envios'
     */
    async getScheduledMessages() {
        try {
            const response = await googleService.sheets.spreadsheets.values.get({
                spreadsheetId: googleService.sheetId,
                range: 'Envios!A2:E'
            })
            const rows = response.data.values || []

            return rows.map((row, index) => ({
                rowIndex: index + 2, // +2 porque empezamos en A2
                numeroWhatsapp: row[0] || '',
                mensajeTexto: row[1] || '',
                mediaUrl: row[2] || '',
                hora: row[3] || '',
                estado: row[4] || 'Pendiente'
            })).filter(m => m.numeroWhatsapp && m.mensajeTexto)
        } catch (error) {
            console.error('❌ Error al obtener mensajes programados:', error.message)
            return []
        }
    }

    /**
     * Parsea fecha en formato DD/MM/YYYY HH:mm:ss
     */
    parseDateTime(dateTimeStr) {
        if (!dateTimeStr) return null

        try {
            // Formato: DD/MM/YYYY HH:mm:ss o DD/MM/YYYY H:mm:ss
            const parts = dateTimeStr.trim().split(' ')
            if (parts.length < 2) return null

            const dateParts = parts[0].split('/')
            const timeParts = parts[1].split(':')

            if (dateParts.length < 3) return null

            const day = parseInt(dateParts[0])
            const month = parseInt(dateParts[1]) - 1 // Meses van de 0-11
            const year = parseInt(dateParts[2])
            const hour = parseInt(timeParts[0])
            const minute = parseInt(timeParts[1]) || 0
            const second = parseInt(timeParts[2]) || 0

            return new Date(year, month, day, hour, minute, second)
        } catch {
            return null
        }
    }

    /**
     * Verifica si estamos en horario permitido
     */
    isWithinAllowedHours() {
        const now = new Date()
        const hour = now.getHours()
        return hour >= this.config.startHour && hour < this.config.endHour
    }

    /**
     * Genera delay aleatorio entre min y max
     */
    getRandomDelay() {
        return Math.floor(Math.random() * (this.config.maxDelayMs - this.config.minDelayMs)) + this.config.minDelayMs
    }

    /**
     * Verifica y resetea el contador diario si es un nuevo día
     */
    checkDailyReset() {
        const today = new Date().toDateString()
        if (today !== this.lastResetDate) {
            this.dailySentCount = 0
            this.lastResetDate = today
            console.log('📅 Contador diario reseteado')
        }
    }

    /**
     * Actualiza el estado de un mensaje en la hoja
     */
    async updateMessageStatus(rowIndex, newStatus) {
        try {
            await googleService.sheets.spreadsheets.values.update({
                spreadsheetId: googleService.sheetId,
                range: `Envios!E${rowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[newStatus]] }
            })
            return true
        } catch (error) {
            console.error(`❌ Error al actualizar estado fila ${rowIndex}:`, error.message)
            return false
        }
    }

    /**
     * Procesa y envía mensajes pendientes
     * @param {Object} bot - Instancia del bot de WhatsApp
     */
    async processScheduledMessages(bot) {
        // Evitar procesamiento concurrente
        if (this.isProcessing) {
            return
        }

        this.isProcessing = true

        try {
            // Verificar horario permitido
            if (!this.isWithinAllowedHours()) {
                return
            }

            // Verificar/resetear contador diario
            this.checkDailyReset()

            // Verificar límite diario
            if (this.dailySentCount >= this.config.maxDailyMessages) {
                console.log('⚠️ Límite diario de mensajes alcanzado:', this.dailySentCount)
                return
            }

            const messages = await this.getScheduledMessages()
            const now = new Date()

            // Filtrar mensajes pendientes cuya hora ya pasó
            const pendingMessages = messages.filter(m => {
                if (m.estado !== 'Pendiente') return false
                const scheduledTime = this.parseDateTime(m.hora)
                if (!scheduledTime) return false
                return scheduledTime <= now
            })

            if (pendingMessages.length === 0) {
                return
            }

            console.log(`📬 ${pendingMessages.length} mensaje(s) pendiente(s) para enviar`)

            for (const msg of pendingMessages) {
                // Verificar límite diario antes de cada envío
                if (this.dailySentCount >= this.config.maxDailyMessages) {
                    console.log('⚠️ Límite diario alcanzado durante procesamiento')
                    break
                }

                try {
                    // Formatear número (asegurar formato correcto)
                    const numero = msg.numeroWhatsapp.replace(/\D/g, '')

                    console.log(`📤 Enviando mensaje a ${numero}...`)

                    // Enviar mensaje
                    if (msg.mediaUrl && msg.mediaUrl.trim()) {
                        await bot.sendMessage(numero, msg.mensajeTexto, { media: msg.mediaUrl.trim() })
                    } else {
                        await bot.sendMessage(numero, msg.mensajeTexto, {})
                    }

                    // Actualizar estado a Enviado
                    await this.updateMessageStatus(msg.rowIndex, 'Enviado')
                    this.dailySentCount++

                    console.log(`✅ Mensaje enviado a ${numero} (${this.dailySentCount}/${this.config.maxDailyMessages})`)

                    // Delay aleatorio antes del siguiente mensaje
                    if (pendingMessages.indexOf(msg) < pendingMessages.length - 1) {
                        const delay = this.getRandomDelay()
                        console.log(`⏳ Esperando ${delay / 1000}s antes del siguiente envío...`)
                        await new Promise(resolve => setTimeout(resolve, delay))
                    }

                } catch (sendError) {
                    console.error(`❌ Error enviando a ${msg.numeroWhatsapp}:`, sendError.message)
                    await this.updateMessageStatus(msg.rowIndex, 'Error')
                }
            }

        } catch (error) {
            console.error('❌ Error en processScheduledMessages:', error.message)
        } finally {
            this.isProcessing = false
        }
    }

    /**
     * Inicia el scheduler de mensajes programados
     * @param {Object} bot - Instancia del bot de WhatsApp
     */
    startScheduler(bot) {
        console.log('📅 Scheduler de mensajes programados iniciado')
        console.log(`   ⏰ Verificación cada ${this.config.checkIntervalMs / 1000}s`)
        console.log(`   🕐 Horario permitido: ${this.config.startHour}:00 - ${this.config.endHour}:00`)
        console.log(`   📊 Límite diario: ${this.config.maxDailyMessages} mensajes`)

        // Ejecutar inmediatamente una vez
        this.processScheduledMessages(bot)

        // Configurar intervalo
        setInterval(() => {
            this.processScheduledMessages(bot)
        }, this.config.checkIntervalMs)
    }
}

const scheduledMessagesService = new ScheduledMessagesService()
export default scheduledMessagesService
