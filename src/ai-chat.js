import Groq from 'groq-sdk'
import googleService from './googleService.js'
import chatHistoryService from './chat-history.js'

/**
 * @class GroqService
 * Esta clase maneja toda la comunicación con la API de Groq.
 * Su responsabilidad es tomar un mensaje del usuario, obtener la configuración
 * desde Google Sheets y generar una respuesta inteligente.
 */
class GroqService {
    constructor() {
        console.log('🔑 Inicializando GroqService...')
        console.log('📁 Directorio actual:', process.cwd())
        console.log('🔑 API Key disponible:', process.env.GROQ_API_KEY ? 'Sí (' + process.env.GROQ_API_KEY.substring(0, 10) + '...)' : 'No')
        console.log('🔑 Longitud API Key:', process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.length : 0)
        this.groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        })
        this.settings = null
    }

    /**
     * Convierte hora de formato 24h a 12h con AM/PM
     * @param {string} time24 - Hora en formato 24h (ej: "13:00", "09:30")
     * @returns {string} Hora en formato 12h (ej: "01:00 PM", "09:30 AM")
     */
    formatTo12Hour(time24) {
        if (!time24) return ''
        const [hourStr, minute] = time24.split(':')
        let hour = parseInt(hourStr)
        const ampm = hour >= 12 ? 'PM' : 'AM'
        hour = hour % 12 || 12 // Convierte 0 a 12 y 13-23 a 1-11
        return `${hour.toString().padStart(2, '0')}:${minute} ${ampm}`
    }


    /**
     * Carga la configuración de la IA (prompts y parámetros) desde Google Sheets.
     * Esta función se llama solo una vez y luego los datos se guardan en la caché.
     */
    async loadSettings() {
        const settings = await googleService.getPrompts()
        for (const key in settings) {
            if (!isNaN(settings[key])) {
                settings[key] = Number(settings[key])
            }
        }
        this.settings = settings
    }

    /**
     * Genera una respuesta de la IA.
     * @param {string} userInput - El último mensaje que el usuario ha enviado.
     * @param {string} phoneNumber - Número de teléfono del contacto para obtener el historial.
     * @returns {Promise<string>} La respuesta de texto generada por el modelo de IA.
     */
    async getResponse(userInput, phoneNumber = null) {
        if (!this.settings) {
            await this.loadSettings()
        }

        if (phoneNumber) {
            const session = await chatHistoryService.getAppointmentSession(phoneNumber)
            if (session && session.state && session.state !== 'idle') {
                return await this.continueAppointmentFlow(userInput, phoneNumber, session)
            }
        }

        const intent = await this.detectIntent(userInput)
        if (intent && intent.type && intent.type !== 'none') {
            if (intent.type === 'appointment') {
                // Sistema escolar: siempre iniciamos con el flujo de ID de estudiante
                return await this.beginAppointmentFlow(phoneNumber)
            }
            if (intent.type === 'cancel' || intent.type === 'list') {
                return await this.handleAppointmentQueryOrCancel(userInput, phoneNumber)
            }
        }

        // Detectar si es un comando de agendamiento
        const lowerInput = userInput.toLowerCase()
        if (lowerInput.includes('agenda cita') || lowerInput.includes('agendar cita') || lowerInput.includes('reservar entrenamiento') || lowerInput.includes('horarios disponibles')) {
            return await this.handleAppointmentRequest(userInput, phoneNumber)
        } else if (lowerInput.includes('mis citas') || lowerInput.includes('cancelar cita')) {
            return await this.handleAppointmentQueryOrCancel(userInput, phoneNumber)
        }

        // Respuesta estándar de IA
        try {
            // Prompt optimizado para agendamiento escolar
            const defaultPrompt = `Eres el asistente virtual del Colegio San Martín. Tu rol es ayudar a padres de familia de manera amable y conversacional.

REGLAS IMPORTANTES:
1. NUNCA pidas datos personales (nombre, cédula, email) directamente. Los datos se recolectan automáticamente cuando el padre inicia el proceso de agendamiento escribiendo "agendar cita".
2. Si el padre menciona que quiere hablar con un profesor, agendar una cita, o tiene alguna inquietud sobre su hijo, guíalo amablemente a escribir "agendar cita" para iniciar el proceso formal.
3. Sé breve, cálido y profesional. Respuestas de máximo 2-3 oraciones.
4. Si el padre solo saluda ("hola", "buenos días"), responde con un saludo cordial y pregunta en qué puedes ayudarle.
5. Si preguntan por horarios, disponibilidad o información general, responde que pueden agendar una cita directamente escribiendo "agendar cita".

EJEMPLO DE RESPUESTAS CORRECTAS:
- "¡Hola! Soy el asistente del Colegio San Martín. ¿En qué puedo ayudarte hoy?"
- "Entiendo que deseas hablar con el docente sobre el rendimiento de tu hijo. Para agendar la cita, simplemente escribe 'agendar cita' y te guiaré paso a paso."
- "Con gusto te ayudo a coordinar una cita. Escribe 'agendar cita' para comenzar el proceso."`

            const messages = [
                {
                    role: 'system',
                    content: this.settings.system_prompt || defaultPrompt,
                }
            ]

            if (phoneNumber) {
                const contextMessages = await chatHistoryService.getContextForAI(phoneNumber)
                messages.push(...contextMessages)
                console.log(`🧠 Contexto cargado para ${phoneNumber}: ${contextMessages.length} mensajes`)
            }

            messages.push({
                role: 'user',
                content: userInput,
            })

            const chatCompletion = await this.groq.chat.completions.create({
                messages,
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                temperature: this.settings.temperature || 0.5,
                max_tokens: this.settings.max_tokens || 200,
                top_p: this.settings.top_p || 1,
                stop: this.settings.stop || null,
                stream: false,
            })

            const aiResponse = chatCompletion.choices[0]?.message?.content || 'No he podido generar una respuesta.'

            if (phoneNumber) {
                await chatHistoryService.saveMessage(phoneNumber, 'user', userInput)
                await chatHistoryService.saveMessage(phoneNumber, 'assistant', aiResponse)
            }

            return aiResponse
        } catch (error) {
            console.error('❌ Error al contactar con la API de Groq:', error)
            return 'Lo siento, estoy teniendo problemas para conectar con mi cerebro de IA en este momento.'
        }
    }

    async beginAppointmentFlow(phoneNumber) {
        // Nuevo flujo escolar: pedir ID de estudiante primero
        await chatHistoryService.saveAppointmentSession(phoneNumber, {
            state: 'collecting_student_id',
            data: { attempts: 0, lastActivity: new Date().toISOString() }
        })
        return `📚 *Sistema de Agendamiento de Citas*

Indícame el número de matricula del estudiante para proceder a agendar tu cita con un docente.

_Escribe 'cancelar' en cualquier momento para salir del proceso._`
    }


    async detectIntent(text) {
        try {
            const lowerText = text.toLowerCase()

            // PRIORIDAD 1: Comandos de gestión de citas (cancelar, reprogramar, consultar)
            if (lowerText.includes('cancelar cita') || lowerText.includes('cancelar la cita')) {
                return { type: 'cancel' }
            }
            if (lowerText.includes('reprogramar cita') || lowerText.includes('reprogramar la cita')) {
                return { type: 'cancel' } // Redirige al mismo handler
            }
            if (lowerText.includes('mis citas') || lowerText.includes('ver citas') || lowerText.includes('consultar cita')) {
                return { type: 'list' }
            }

            // PRIORIDAD 2: Detectar intención de AGENDAR nueva cita
            const agendarHeuristic = /(agend(ar|a)|reservar|quiero.*cita|necesito.*cita|horarios disponibles)/i
            if (agendarHeuristic.test(text)) {
                return { type: 'appointment' }
            }

            // PRIORIDAD 3: IA para casos ambiguos (solo si contiene "cita" pero no es claro)
            if (/cita/i.test(text)) {
                const resp = await this.groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: 'Clasifica la intención del usuario sobre citas. Responde SOLO JSON: {"type":"appointment|cancel|list|none"}' },
                        { role: 'user', content: text }
                    ],
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    temperature: 0,
                    max_tokens: 50
                })
                const content = resp.choices[0]?.message?.content || '{}'
                try {
                    return JSON.parse(content)
                } catch {
                    const m = content.match(/\{[\s\S]*\}/)
                    if (m) return JSON.parse(m[0])
                }
            }

            return { type: 'none' }
        } catch {
            return { type: 'none' }
        }
    }

    async handleAppointmentRequest(userInput, phoneNumber) {
        try {
            // Nuevo flujo escolar: iniciar pidiendo ID de estudiante
            return await this.beginAppointmentFlow(phoneNumber)
        } catch (error) {
            console.error('❌ Error en handleAppointmentRequest:', error)
            return 'Error al iniciar el proceso de agendamiento. Por favor, intenta de nuevo.'
        }
    }

    // NOTA: handleAppointmentRequestLegacy eliminado - Sistema escolar usa flujo de estados

    // Configuración de límites
    static MAX_ATTEMPTS = 3 // Máximo intentos por pregunta
    static SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutos de inactividad

    async continueAppointmentFlow(userInput, phoneNumber, session) {
        try {
            const state = session.state
            const text = userInput.trim()
            const textLower = text.toLowerCase()

            // === VERIFICAR TIMEOUT POR INACTIVIDAD ===
            if (session.data && session.data.lastActivity) {
                const lastActivity = new Date(session.data.lastActivity).getTime()
                const now = Date.now()
                if (now - lastActivity > GroqService.SESSION_TIMEOUT_MS) {
                    await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                    return `⏱️ Tu proceso de agendamiento fue cancelado por inactividad.\n\nPara iniciar nuevamente, escribe 'agendar cita'.`
                }
            }

            // === CANCELAR PROCESO ===
            if (textLower === 'cancelar' || textLower === 'salir' || textLower === 'desistir') {
                await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                return `❌ Proceso cancelado.\n\nSi deseas agendar una cita, escribe 'agendar cita'. ¡Estamos para ayudarte!`
            }

            // === ESTADO: ESPERANDO ID ESTUDIANTE PARA CANCELAR CITA ===
            if (state === 'awaiting_cancel_id') {
                // Permitir ver citas mientras espera el ID
                if (textLower.includes('mis citas') || textLower.includes('ver citas')) {
                    await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                    return await this.handleAppointmentQueryOrCancel('mis citas', phoneNumber)
                }

                const studentId = text.trim()
                if (!studentId || studentId.length < 3) {
                    return 'Por favor indica el número de matricula del estudiante.\n\n_Escribe el ID o "salir" para cancelar._'
                }

                // Buscar citas por ID del estudiante
                const allAppointments = await googleService.getAppointmentsByPhone(phoneNumber)
                const studentAppointments = allAppointments.filter(apt => apt.idEstudiante === studentId)

                if (studentAppointments.length === 0) {
                    return `No encontré citas para el estudiante con ID ${studentId}.\n\nVerifica el número e intenta de nuevo.\n\n_Escribe otro ID o "salir" para cancelar._`
                }

                // Si hay múltiples citas, guardar lista y pedir selección
                if (studentAppointments.length > 1) {
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'selecting_appointment_to_cancel',
                        data: { studentId, appointments: studentAppointments }
                    })
                    let mensaje = `📅 El estudiante ${studentAppointments[0].estudiante} tiene ${studentAppointments.length} citas:\n\n`
                    studentAppointments.forEach((apt, i) => {
                        mensaje += `${i + 1}. ${apt.fechaCita} a las ${this.formatTo12Hour(apt.hora)}\n   👨‍🏫 ${apt.docente}\n\n`
                    })
                    mensaje += `¿Cuál deseas cancelar? Escribe el número (1, 2, etc.) o "todas" para cancelar todas.`
                    return mensaje
                }

                // Solo una cita, cancelar directamente
                const appointment = studentAppointments[0]

                // Cancelar en Google Calendar
                if (appointment.eventId) {
                    const docenteMatch = appointment.docente.match(/^([^(]+)/)
                    const docenteName = docenteMatch ? docenteMatch[1].trim() : appointment.docente
                    const docentes = await googleService.getDocentes()
                    const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
                    if (docente && docente.calendarId) {
                        await googleService.deleteEvent(appointment.eventId, docente.calendarId)
                    }
                }

                // Actualizar estado en Sheets
                await googleService.updateAppointmentStatus(appointment.id, 'Cancelada')

                // Resetear sesión
                await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })

                return `❌ Cita cancelada exitosamente.\n\n👨‍🎓 Estudiante: ${appointment.estudiante} (ID: ${studentId})\n📅 Era el ${appointment.fechaCita} a las ${this.formatTo12Hour(appointment.hora)}\n👨‍🏫 ${appointment.docente}\n\n¿Deseas agendar otra cita? Escribe "agendar cita"`
            }

            // === ESTADO: SELECCIONAR CITA A CANCELAR (cuando hay múltiples) ===
            if (state === 'selecting_appointment_to_cancel') {
                const { studentId, appointments } = session.data

                if (textLower === 'todas') {
                    // Cancelar todas las citas
                    for (const apt of appointments) {
                        if (apt.eventId) {
                            const docenteMatch = apt.docente.match(/^([^(]+)/)
                            const docenteName = docenteMatch ? docenteMatch[1].trim() : apt.docente
                            const docentes = await googleService.getDocentes()
                            const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
                            if (docente && docente.calendarId) {
                                await googleService.deleteEvent(apt.eventId, docente.calendarId)
                            }
                        }
                        await googleService.updateAppointmentStatus(apt.id, 'Cancelada')
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                    return `❌ Se cancelaron ${appointments.length} citas del estudiante ${appointments[0].estudiante}.\n\n¿Deseas agendar otra cita? Escribe "agendar cita"`
                }

                const selectionNum = parseInt(text)
                if (isNaN(selectionNum) || selectionNum < 1 || selectionNum > appointments.length) {
                    return `Por favor escribe un número del 1 al ${appointments.length}, o "todas" para cancelar todas.\n\n_O "salir" para cancelar._`
                }

                const appointment = appointments[selectionNum - 1]

                // Cancelar en Google Calendar
                if (appointment.eventId) {
                    const docenteMatch = appointment.docente.match(/^([^(]+)/)
                    const docenteName = docenteMatch ? docenteMatch[1].trim() : appointment.docente
                    const docentes = await googleService.getDocentes()
                    const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
                    if (docente && docente.calendarId) {
                        await googleService.deleteEvent(appointment.eventId, docente.calendarId)
                    }
                }

                await googleService.updateAppointmentStatus(appointment.id, 'Cancelada')
                await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })

                return `❌ Cita cancelada exitosamente.\n\n👨‍🎓 Estudiante: ${appointment.estudiante}\n📅 Era el ${appointment.fechaCita} a las ${this.formatTo12Hour(appointment.hora)}\n👨‍🏫 ${appointment.docente}\n\n¿Deseas agendar otra cita? Escribe "agendar cita"`
            }

            // === NUEVO FLUJO ESCOLAR ===

            // Obtener intentos actuales del estado
            const attempts = (session.data && session.data.attempts) || 0

            // Estado 1: Recolectar ID del estudiante
            if (state === 'collecting_student_id') {
                const student = await googleService.getStudentById(text)
                if (!student) {
                    const newAttempts = attempts + 1
                    if (newAttempts >= GroqService.MAX_ATTEMPTS) {
                        await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                        return `❌ No pude validar el ID del estudiante después de ${GroqService.MAX_ATTEMPTS} intentos.\n\nEl proceso ha sido cancelado. Si deseas intentar nuevamente, escribe 'agendar cita'.\n\nSi necesitas ayuda, contacta al colegio.`
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_student_id',
                        data: { ...session.data, attempts: newAttempts, lastActivity: new Date().toISOString() }
                    })
                    return `❌ No encontré un estudiante con ID: ${text}\n\n⚠️ Intento ${newAttempts} de ${GroqService.MAX_ATTEMPTS}. Por favor verifica el número de matrícula.`
                }

                // Obtener docentes asignados al estudiante
                const docentesAsignados = await googleService.getDocentesByStudent(text)
                if (docentesAsignados.length === 0) {
                    await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                    return `❌ El estudiante ${student.nombres} no tiene docentes asignados.\n\nContacta a la institución para más información.`
                }

                let mensaje = `👨‍🎓 El estudiante *${student.nombres}* pertenece a:\n\n`
                mensaje += `🎓 Grado: ${student.grado}\n`
                mensaje += `🏫 Curso: ${student.curso}\n`
                mensaje += `🕰️ Jornada: ${student.jornada}\n\n`
                mensaje += `👨‍🏫 *Docentes asignados:*\n`
                docentesAsignados.forEach((d, i) => {
                    mensaje += `${i + 1}. ${d.nombre} - ${d.materia}\n`
                })
                mensaje += `\n❓ ¿Con cuál docente desea agendar una cita?`

                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'collecting_teacher',
                    data: {
                        studentId: text,
                        studentName: student.nombres,
                        grado: student.grado,
                        curso: student.curso,
                        docentesDisponibles: docentesAsignados
                    }
                })
                return mensaje
            }

            // Estado 2: Seleccionar docente
            if (state === 'collecting_teacher') {
                const { docentesDisponibles } = session.data

                // Buscar docente por número o nombre
                let selectedDocente = null
                const num = parseInt(text)
                if (!isNaN(num) && num > 0 && num <= docentesDisponibles.length) {
                    selectedDocente = docentesDisponibles[num - 1]
                } else {
                    selectedDocente = docentesDisponibles.find(d =>
                        d.nombre.toLowerCase().includes(text.toLowerCase())
                    )
                }

                if (!selectedDocente) {
                    const newAttempts = attempts + 1
                    if (newAttempts >= GroqService.MAX_ATTEMPTS) {
                        await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                        return `❌ No pude identificar el docente después de ${GroqService.MAX_ATTEMPTS} intentos.\n\nEl proceso ha sido cancelado. Escribe 'agendar cita' para intentar nuevamente.`
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_teacher',
                        data: { ...session.data, attempts: newAttempts, lastActivity: new Date().toISOString() }
                    })
                    const nombres = docentesDisponibles.map((d, i) => `${i + 1}. ${d.nombre}`).join('\n')
                    return `❌ No encontré ese docente.\n\n⚠️ Intento ${newAttempts} de ${GroqService.MAX_ATTEMPTS}.\n\nDocentes disponibles:\n${nombres}`
                }

                // Obtener datos completos del docente
                const docenteCompleto = await googleService.findDocenteByPartialName(selectedDocente.nombre)
                if (!docenteCompleto) {
                    return `❌ El docente ${selectedDocente.nombre} no está configurado en el sistema.`
                }

                // Verificar modalidades
                const modalidades = await googleService.getDocenteModalidades(selectedDocente.nombre)

                if (modalidades.length === 0) {
                    return `❌ El docente ${selectedDocente.nombre} no tiene modalidades de cita configuradas.`
                }

                // Si solo tiene una modalidad, pasar directamente a fechas
                if (modalidades.length === 1) {
                    const fechasDisponibles = await googleService.getDocenteAvailableDates(selectedDocente.nombre)
                    if (fechasDisponibles.length === 0) {
                        return `❌ El docente ${selectedDocente.nombre} no tiene fechas disponibles configuradas.`
                    }

                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_date',
                        data: {
                            ...session.data,
                            docente: selectedDocente.nombre,
                            materia: selectedDocente.materia,
                            calendarId: docenteCompleto.calendarId,
                            modalidad: modalidades[0],
                            linkMeet: docenteCompleto.linkMeet || '', // Link de Meet del docente
                            fechasDisponibles: fechasDisponibles
                        }
                    })
                    const fechasList = fechasDisponibles.map((f, i) => `${i + 1}. ${f.display}`).join('\n')
                    return `✅ Cita *${modalidades[0]}* con ${selectedDocente.nombre}\n\n📅 Fechas disponibles:\n${fechasList}\n\n☀️ ¿Qué fecha prefieres?`
                }

                // Múltiples modalidades, preguntar
                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'collecting_modality',
                    data: {
                        ...session.data,
                        docente: selectedDocente.nombre,
                        materia: selectedDocente.materia,
                        calendarId: docenteCompleto.calendarId,
                        linkMeet: docenteCompleto.linkMeet || '', // Link de Meet del docente
                        modalidadesDisponibles: modalidades
                    }
                })
                return `👨‍🏫 El docente ${selectedDocente.nombre} tiene disponibilidad:\n\n${modalidades.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\n❓ ¿Cuál modalidad de cita prefieres?`
            }

            // Estado 3: Seleccionar modalidad
            if (state === 'collecting_modality') {
                const { modalidadesDisponibles, docente } = session.data

                let selectedModalidad = null
                const num = parseInt(text)
                if (!isNaN(num) && num > 0 && num <= modalidadesDisponibles.length) {
                    selectedModalidad = modalidadesDisponibles[num - 1]
                } else {
                    selectedModalidad = modalidadesDisponibles.find(m =>
                        m.toLowerCase().includes(text.toLowerCase())
                    )
                }

                if (!selectedModalidad) {
                    const newAttempts = attempts + 1
                    if (newAttempts >= GroqService.MAX_ATTEMPTS) {
                        await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                        return `❌ No pude validar la modalidad después de ${GroqService.MAX_ATTEMPTS} intentos.\n\nEl proceso ha sido cancelado. Escribe 'agendar cita' para intentar nuevamente.`
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_modality',
                        data: { ...session.data, attempts: newAttempts, lastActivity: new Date().toISOString() }
                    })
                    return `❌ Modalidad no válida.\n\n⚠️ Intento ${newAttempts} de ${GroqService.MAX_ATTEMPTS}.\n\nOpciones: ${modalidadesDisponibles.join(', ')}`
                }

                const fechasDisponibles = await googleService.getDocenteAvailableDates(docente)
                if (fechasDisponibles.length === 0) {
                    return `❌ El docente ${docente} no tiene fechas disponibles configuradas.`
                }

                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'collecting_date',
                    data: { ...session.data, modalidad: selectedModalidad, fechasDisponibles: fechasDisponibles }
                })
                const fechasList = fechasDisponibles.map((f, i) => `${i + 1}. ${f.display}`).join('\n')
                return `✅ Cita *${selectedModalidad}* con ${docente}\n\n📅 Fechas disponibles:\n${fechasList}\n\n☀️ ¿Qué fecha prefieres?`
            }

            // Estado 4: Seleccionar fecha concreta
            if (state === 'collecting_date') {
                const { docente, fechasDisponibles } = session.data

                // Buscar fecha usando la función flexible
                const selectedDate = googleService.findDateByText(fechasDisponibles, text)

                if (!selectedDate) {
                    const newAttempts = attempts + 1
                    if (newAttempts >= GroqService.MAX_ATTEMPTS) {
                        await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                        return `❌ No pude validar la fecha después de ${GroqService.MAX_ATTEMPTS} intentos.\n\nEl proceso ha sido cancelado. Escribe 'agendar cita' para intentar nuevamente.`
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_date',
                        data: { ...session.data, attempts: newAttempts, lastActivity: new Date().toISOString() }
                    })
                    const opciones = fechasDisponibles.map((f, i) => `${i + 1}. ${f.display}`).join('\n')
                    return `❌ Fecha no válida.\n\n⚠️ Intento ${newAttempts} de ${GroqService.MAX_ATTEMPTS}.\n\nFechas disponibles:\n${opciones}`
                }

                const horariosResult = await googleService.getDocenteAvailableHours(docente, selectedDate.date)
                const horarios = horariosResult.horarios
                const duracionMinutos = horariosResult.duracionMinutos
                if (horarios.length === 0) {
                    return `❌ No hay horarios disponibles para ${selectedDate.display}.`
                }

                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'collecting_time',
                    data: { ...session.data, day: selectedDate.display, selectedDate: selectedDate.date, duracionMinutos }
                })
                return `⏰ Horarios disponibles para *${selectedDate.display}* (citas de ${duracionMinutos} min):\n\n${horarios.map(h => `• ${this.formatTo12Hour(h)}`).join('\n')}\n\n❓ ¿Qué hora prefieres?`
            }

            // Estado 5: Seleccionar hora
            if (state === 'collecting_time') {
                // Parsear hora con soporte para AM/PM
                const textLowerTime = text.toLowerCase().trim()
                let hour, minute = '00'

                // Detectar AM/PM
                const isPM = textLowerTime.includes('pm') || textLowerTime.includes('p.m')
                const isAM = textLowerTime.includes('am') || textLowerTime.includes('a.m')

                // Extraer números de la hora
                const nums = textLowerTime.replace(/[^\d:]/g, '')
                const m = nums.match(/(\d{1,2}):?(\d{2})?/)

                if (!m) return '❌ Indica una hora válida, por ejemplo: 10:00 AM o 02:00 PM'

                let hourNum = parseInt(m[1])
                minute = m[2] || '00'

                // Convertir a formato 24h si se especificó AM/PM
                if (isPM && hourNum < 12) {
                    hourNum += 12 // 2 PM -> 14
                } else if (isAM && hourNum === 12) {
                    hourNum = 0 // 12 AM -> 00
                } else if (!isPM && !isAM && hourNum >= 1 && hourNum <= 12) {
                    // Sin AM/PM especificado, asumir PM para horas 1-12 si los horarios disponibles son de tarde
                    const { docente, selectedDate } = session.data
                    const horariosResult = await googleService.getDocenteAvailableHours(docente, selectedDate)
                    const horarios = horariosResult.horarios

                    // Si la hora en formato 24h no coincide pero +12 sí, convertir
                    const hour24 = hourNum.toString().padStart(2, '0')
                    const hour24PM = (hourNum + 12).toString().padStart(2, '0')

                    if (!horarios.some(h => h.startsWith(hour24)) && horarios.some(h => h.startsWith(hour24PM))) {
                        hourNum += 12
                    }
                }

                hour = hourNum.toString().padStart(2, '0')
                const time = `${hour}:${minute}`

                const { docente, day, selectedDate } = session.data
                const horariosResult = await googleService.getDocenteAvailableHours(docente, selectedDate)
                const horarios = horariosResult.horarios

                if (!horarios.some(h => h.startsWith(hour))) {
                    const newAttempts = attempts + 1
                    if (newAttempts >= GroqService.MAX_ATTEMPTS) {
                        await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
                        return `❌ No pude validar la hora después de ${GroqService.MAX_ATTEMPTS} intentos.\n\nEl proceso ha sido cancelado. Escribe 'agendar cita' para intentar nuevamente.`
                    }
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_time',
                        data: { ...session.data, attempts: newAttempts, lastActivity: new Date().toISOString() }
                    })
                    // Mostrar horarios en formato AM/PM
                    const horariosAmPm = horarios.map(h => this.formatTo12Hour(h)).join(', ')
                    return `❌ La hora ${this.formatTo12Hour(time)} no está disponible.\n\n⚠️ Intento ${newAttempts} de ${GroqService.MAX_ATTEMPTS}.\n\nOpciones: ${horariosAmPm}`
                }

                // Obtener campos del formulario y comenzar recolección dinámica
                const formFields = await googleService.getFormFields()
                if (formFields.length > 0) {
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_form_field',
                        data: {
                            ...session.data,
                            time,
                            formFields: formFields,
                            currentFieldIndex: 0,
                            collectedData: {}
                        }
                    })
                    return formFields[0].pregunta
                }
                // Si no hay campos, ir directo a confirmación
                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'confirming_appointment',
                    data: { ...session.data, time, collectedData: {} }
                })
                return await this.confirmAppointment(phoneNumber, session.data)
            }

            // Estado dinámico: Recolectar campos del formulario
            if (state === 'collecting_form_field') {
                const { formFields, currentFieldIndex, collectedData } = session.data
                const currentField = formFields[currentFieldIndex]

                // Validación de email si el campo es email
                if (currentField.id === 'email') {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    if (!emailRegex.test(text)) {
                        return '❌ Por favor proporciona un email válido (ejemplo: usuario@ejemplo.com)'
                    }
                }

                // Guardar el valor recolectado
                const newCollectedData = { ...collectedData, [currentField.id]: text }

                // Verificar si hay más campos
                const nextIndex = currentFieldIndex + 1
                if (nextIndex < formFields.length) {
                    // Siguiente campo
                    await chatHistoryService.saveAppointmentSession(phoneNumber, {
                        state: 'collecting_form_field',
                        data: {
                            ...session.data,
                            currentFieldIndex: nextIndex,
                            collectedData: newCollectedData
                        }
                    })
                    return formFields[nextIndex].pregunta
                }

                // Todos los campos recolectados, confirmar cita
                const { studentId, studentName, docente, materia, modalidad, linkMeet, day, selectedDate, time, calendarId, grado, curso } = session.data

                // Usar la fecha seleccionada (ya está en formato YYYY-MM-DD)
                const dateStr = selectedDate || googleService.getNextDayDate(day)

                // Obtener pie de confirmación
                const footerMessage = await googleService.getConfirmationFooter()

                // 1. Crear evento en Google Calendar
                const startTime = new Date(`${dateStr}T${time}:00`).toISOString()
                const duracion = session.data.duracionMinutos || 30 // Usar duración del docente
                const endTime = new Date(new Date(startTime).getTime() + duracion * 60 * 1000).toISOString()

                // Construir descripción dinámica
                let eventDescription = `Estudiante: ${studentName} (ID: ${studentId})\nGrado: ${grado} - Curso: ${curso}\nDocente: ${docente} (${materia})\nModalidad: ${modalidad}\n`
                for (const [key, value] of Object.entries(newCollectedData)) {
                    eventDescription += `${key}: ${value}\n`
                }

                const event = await googleService.createEvent(
                    phoneNumber,
                    calendarId,
                    startTime,
                    endTime,
                    `Cita: ${newCollectedData.nombre || 'Padre'} - Estudiante: ${studentName}`,
                    eventDescription
                )

                // 2. Guardar en Google Sheets
                const appointmentId = await googleService.saveAppointmentToSheet({
                    ...newCollectedData, // Pasar todos los campos dinámicos recolectados
                    whatsapp: phoneNumber,
                    studentName,
                    studentId,
                    entrenador: `${docente} (${materia})`,
                    fecha: dateStr,
                    hora: time,
                    estado: 'Confirmada',
                    eventId: event.id
                })

                // 3. Resetear sesión
                await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })

                // 4. Construir mensaje de confirmación dinámico
                let confirmMsg = `✅ *¡Cita confirmada!*\n\n📋 ID de Cita: ${appointmentId}\n\n`
                confirmMsg += `👨‍🎓 Estudiante: ${studentName}\n🎓 Grado ${grado} - Curso ${curso}\n\n`

                // Agregar datos recolectados dinámicamente
                for (const field of formFields) {
                    const iconMap = { nombre: '👤', documento: '📄', email: '📧', objetivo: '🎯' }
                    const icon = iconMap[field.id] || '•'
                    confirmMsg += `${icon} ${field.id}: ${newCollectedData[field.id] || ''}\n`
                }

                confirmMsg += `\n👨‍🏫 Docente: ${docente}\n📚 Materia: ${materia}\n💻 Modalidad: ${modalidad}\n`
                confirmMsg += `\n📅 Fecha: ${day} (${dateStr})\n⏰ Hora: ${this.formatTo12Hour(time)}\n`

                // Si es virtual y hay link de Meet del docente, agregarlo
                const isVirtual = modalidad && modalidad.toLowerCase().includes('virtual')
                if (isVirtual && linkMeet) {
                    confirmMsg += `\n📹 *Reunión Virtual:*\n${linkMeet}\n`
                } else if (isVirtual && !linkMeet) {
                    confirmMsg += `\n⚠️ El docente no tiene link de reunión configurado. Contacta directamente al docente.\n`
                }

                confirmMsg += `\n` + footerMessage

                return confirmMsg
            }

            // Si llegamos aquí, el estado no es reconocido - resetear
            return 'Continuemos con tu cita. Por favor escribe "agendar cita" para iniciar.'
        } catch (error) {
            console.error('❌ Error en continueAppointmentFlow:', error)
            await chatHistoryService.saveAppointmentSession(phoneNumber, { state: 'idle', data: {} })
            return 'Ocurrió un problema al procesar tu solicitud. Por favor intenta de nuevo escribiendo "agendar cita".'
        }
    }

    async handleAppointmentQueryOrCancel(userInput, phoneNumber) {
        try {
            const lowerInput = userInput.toLowerCase()

            // Consultar citas
            if (lowerInput.includes('mis citas') || lowerInput.includes('consultar')) {
                const appointments = await googleService.getAppointmentsByPhone(phoneNumber)

                if (appointments.length === 0) {
                    return 'No tienes citas programadas próximamente.'
                }

                let mensaje = `📅 Tus Citas Confirmadas:\n\n`
                appointments.forEach((apt, index) => {
                    mensaje += `${index + 1}. 👨‍🎓 ${apt.estudiante} (ID: ${apt.idEstudiante})\n`
                    mensaje += `   📅 ${apt.fechaCita} a las ${this.formatTo12Hour(apt.hora)}\n`
                    mensaje += `   👨‍🏫 ${apt.docente}\n\n`
                })

                mensaje += `Para cancelar, escribe: "cancelar cita" y luego el ID del estudiante.`

                return mensaje
            }

            // Cancelar cita
            if (lowerInput.includes('cancelar')) {
                // Guardar estado para esperar el ID del estudiante
                await chatHistoryService.saveAppointmentSession(phoneNumber, {
                    state: 'awaiting_cancel_id',
                    data: {}
                })
                return 'Indica el número de matricula del estudiante cuya cita deseas cancelar.\n\n_Escribe el ID del estudiante o "salir" para cancelar._'
            }

            // Reprogramar cita
            if (lowerInput.includes('reprogramar')) {
                const idMatch = userInput.match(/\d+/)
                if (!idMatch) {
                    return 'Indica el ID de la cita a reprogramar. Usa "mis citas" para ver tus citas.'
                }

                const appointmentId = idMatch[0]
                const appointments = await googleService.getAppointmentsByPhone(phoneNumber)
                const appointment = appointments.find(apt => apt.id === appointmentId)

                if (!appointment) {
                    return `No encontré la cita ${appointmentId}. Verifica el ID con "mis citas".`
                }

                // Cancelar la cita actual en el calendario
                if (appointment.eventId) {
                    const docenteMatch = appointment.docente.match(/^([^(]+)/)
                    const docenteName = docenteMatch ? docenteMatch[1].trim() : appointment.docente

                    const docentes = await googleService.getDocentes()
                    const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
                    if (docente && docente.calendarId) {
                        await googleService.deleteEvent(appointment.eventId, docente.calendarId)
                    }
                }
                await googleService.updateAppointmentStatus(appointmentId, 'Reprogramada')

                // Para reprogramar, el usuario debe iniciar un nuevo flujo de agendamiento
                return `🔄 Cita ${appointmentId} marcada para reprogramar.

📅 Era el ${appointment.fechaCita} a las ${this.formatTo12Hour(appointment.hora)}
👨‍🏫 ${appointment.docente}
👨‍🎓 Estudiante: ${appointment.estudiante}

Para agendar la nueva fecha, escribe "agendar cita" y sigue el proceso.`
            }

            return 'No entendí. Usa "mis citas", "cancelar cita ID" o "reprogramar cita ID".'
        } catch (error) {
            console.error('❌ Error en handleAppointmentQueryOrCancel:', error)
            return 'Error al procesar tu solicitud de citas.'
        }
    }
}


const groqService = new GroqService()
export default groqService

