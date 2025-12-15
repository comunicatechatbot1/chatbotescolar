import { GoogleAuth } from 'google-auth-library'
import { google } from 'googleapis'

class GoogleService {
    constructor() {
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        this.auth = new GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/calendar'
            ],
        })
        this.sheets = google.sheets({ version: 'v4', auth: this.auth })
        this.calendar = google.calendar({ version: 'v3', auth: this.auth })

        this.sheetId = process.env.SHEET_ID
        this.calendarId = process.env.CALENDAR_ID || 'primary' // Configurar en .env

        // Caché similar a sheets.js
        this.flowsCache = null
        this.promptsCache = null
        this.scheduledMessagesCache = null
        this.lastFlowsFetch = 0
        this.lastPromptsFetch = 0
        this.lastScheduledMessagesFetch = 0
        this.cacheDuration = 5 * 60 * 1000
    }

    async verifyCalendarAccess() {
        try {
            const cal = await this.calendar.calendars.get({ calendarId: this.calendarId })
            console.log(`✅ Calendar encontrado: ${cal.data.summary} (${cal.data.id}) TZ: ${cal.data.timeZone}`)

            const now = new Date()
            const res = await this.calendar.events.list({
                calendarId: this.calendarId,
                timeMin: now.toISOString(),
                timeMax: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 1
            })
            const count = Array.isArray(res.data.items) ? res.data.items.length : 0
            console.log(`✅ Lectura de eventos ok. Próximos eventos encontrados: ${count}`)
            return true
        } catch (error) {
            console.error('❌ Verificación de Calendar falló:', error)
            return false
        }
    }

    // Funciones de Sheets (copiadas y adaptadas de sheets.js)
    async getFlows() {
        const now = Date.now()
        if (this.flowsCache && now - this.lastFlowsFetch < this.cacheDuration) {
            console.log('✅ Usando caché de flujos.')
            return this.flowsCache
        }

        console.log('🔄 Caché expirada. Obteniendo flujos desde Google Sheets...')
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Flujos!A2:C',
            })

            const rows = response.data.values || []
            const headers = [
                'addKeyword',
                'addAnswer',
                'media',
            ]

            let flows = rows.map((row) => {
                const flow = {}
                headers.forEach((header, index) => {
                    flow[header] = row[index] || null
                })
                return flow
            })

            const appointmentKeywords = /(agend(ar|a)|reservar|cita|entrenamiento|sesión|sesion)/i
            flows = flows.filter(f => !appointmentKeywords.test(String(f.addKeyword || '')))

            this.flowsCache = flows
            this.lastFlowsFetch = now
            console.log(`✅ Flujos cargados y cacheados correctamente. Total: ${flows.length}`)
            return flows
        } catch (error) {
            console.error('❌ Error al obtener datos de Google Sheets:', error)
            return []
        }
    }

    async getPrompts() {
        const now = Date.now()
        if (this.promptsCache && now - this.lastPromptsFetch < this.cacheDuration) {
            console.log('✅ Usando caché de prompts.')
            return this.promptsCache
        }

        console.log('🔄 Caché expirada. Obteniendo prompts desde Google Sheets...')
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'IA_Prompts!A2:C',
            })

            const rows = response.data.values || []
            const settings = {}

            if (rows.length > 0 && rows[0][0]) {
                settings['system_prompt'] = rows[0][0]
            }

            rows.forEach(row => {
                const key = row[1]
                const value = row[2]
                if (key && value) {
                    settings[key] = value
                }
            })

            this.promptsCache = settings
            this.lastPromptsFetch = now
            console.log(`✅ Prompts cargados y cacheados correctamente.`, settings)
            return settings
        } catch (error) {
            console.error('❌ Error al obtener prompts de Google Sheets:', error)
            return {}
        }
    }



    invalidateCache() {
        this.flowsCache = null
        this.promptsCache = null
        this.scheduledMessagesCache = null
        this.lastFlowsFetch = 0
        this.lastPromptsFetch = 0
        this.lastScheduledMessagesFetch = 0
        console.log('🔄 Todas las cachés invalidadas')
    }



    // Nuevas funciones para Calendar (Fase 1)
    async getAvailableSlots(instructorCalendarId, startTime, endTime) {
        try {
            const res = await this.calendar.freebusy.query({
                requestBody: {
                    timeMin: startTime,
                    timeMax: endTime,
                    items: [{ id: instructorCalendarId || this.calendarId }]
                }
            })
            const busy = res.data.calendars[instructorCalendarId || this.calendarId].busy
            // Lógica para calcular slots libres (ej. dividir en intervalos de 1 hora)
            const slots = this.calculateFreeSlots(startTime, endTime, busy)
            return slots
        } catch (error) {
            console.error('❌ Error al obtener slots disponibles:', error)
            return []
        }
    }

    // Obtener slots ocupados del calendario
    async getBusySlots(calendarId, startTime, endTime) {
        try {
            const res = await this.calendar.freebusy.query({
                requestBody: {
                    timeMin: startTime,
                    timeMax: endTime,
                    items: [{ id: calendarId || this.calendarId }]
                }
            })
            return res.data.calendars[calendarId || this.calendarId].busy || []
        } catch (error) {
            console.error('❌ Error al obtener slots ocupados:', error)
            return []
        }
    }

    calculateFreeSlots(start, end, busyIntervals) {
        // Implementación simple: asumir slots de 1 hora, retornar libres
        const freeSlots = []
        let current = new Date(start)
        const endDate = new Date(end)
        while (current < endDate) {
            const slotEnd = new Date(current.getTime() + 60 * 60 * 1000) // 1 hora
            if (!this.isBusy(current, slotEnd, busyIntervals)) {
                freeSlots.push({ start: current.toISOString(), end: slotEnd.toISOString() })
            }
            current = slotEnd
        }
        return freeSlots
    }

    isBusy(start, end, busyIntervals) {
        return busyIntervals.some(interval => {
            const busyStart = new Date(interval.start)
            const busyEnd = new Date(interval.end)
            return start < busyEnd && end > busyStart
        })
    }

    async createEvent(userPhone, instructorCalendarId, startTime, endTime, summary, description) {
        try {
            const event = {
                summary,
                description: `Cita con ${userPhone}. ${description}`,
                start: { dateTime: startTime, timeZone: 'America/Bogota' },
                end: { dateTime: endTime, timeZone: 'America/Bogota' },
                extendedProperties: { private: { userPhone } }
            }

            console.log('📅 Creando evento en calendario...')
            const res = await this.calendar.events.insert({
                calendarId: instructorCalendarId || this.calendarId,
                resource: event
            })

            console.log('✅ Evento creado:', res.data.id)
            return res.data
        } catch (error) {
            console.error('❌ Error al crear evento:', error)
            throw error
        }
    }

    async getUserEvents(userPhone, calendarId = this.calendarId) {
        try {
            const res = await this.calendar.events.list({
                calendarId,
                timeMin: (new Date()).toISOString(),
                maxResults: 10,
                singleEvents: true,
                orderBy: 'startTime',
                q: userPhone // Buscar en summary o description
            })
            return res.data.items.filter(event => event.extendedProperties?.private?.userPhone === userPhone)
        } catch (error) {
            console.error('❌ Error al obtener eventos:', error)
            return []
        }
    }

    async deleteEvent(eventId, calendarId = this.calendarId) {
        try {
            await this.calendar.events.delete({
                calendarId,
                eventId
            })
            return true
        } catch (error) {
            console.error('❌ Error al eliminar evento:', error)
            return false
        }
    }

    // === FUNCIONES PARA SISTEMA ESCOLAR ===
    // NOTA: Hoja Instructores eliminada - se usa Docentes

    async ensureStudentsSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('Estudiantes')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'Estudiantes'
                                }
                            }
                        }]
                    }
                })
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Estudiantes!A1:F1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['ID_Estudiante', 'Nombres_Apellidos', 'Curso', 'Grado', 'Jornada', 'Docentes_Asignados']]
                    }
                })
                console.log('✅ Hoja Estudiantes creada')
            } else {
                console.log('✅ Hoja Estudiantes ya existe')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja Estudiantes:', error)
        }
    }

    async ensureDocentesSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('Docentes')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'Docentes'
                                }
                            }
                        }]
                    }
                })
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Docentes!A1:G1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['Nombre', 'CalendarID', 'Materia', 'Modalidad', 'DiasDisponibles', 'HorariosDisponibles', 'Duracion_Minutos']]
                    }
                })
                console.log('✅ Hoja Docentes creada')
            } else {
                console.log('✅ Hoja Docentes ya existe')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja Docentes:', error)
        }
    }

    async getStudentById(studentId) {
        try {
            // Consulta en tiempo real para datos actualizados
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Estudiantes!A2:F'
            })
            const rows = response.data.values || []
            const normalizedId = String(studentId).trim()
            const row = rows.find(r => String(r[0]).trim() === normalizedId)
            if (!row) return null
            return {
                id: row[0] || '',
                nombres: row[1] || '',
                curso: row[2] || '',
                grado: row[3] || '',
                jornada: row[4] || '',
                docentesAsignados: row[5] || '' // Formato: "Nombre-Materia, Nombre-Materia"
            }
        } catch (error) {
            console.error('❌ Error al buscar estudiante:', error)
            return null
        }
    }

    async getDocentes() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Docentes!A2:H' // Incluye columna H para Link_Meet
            })
            const rows = response.data.values || []

            const docentes = rows.map(row => ({
                name: row[0] || '',
                calendarId: row[1] || '',
                materia: row[2] || '',
                modalidad: row[3] || '',
                diasDisponibles: row[4] || '',
                horariosDisponibles: row[5] || '',
                duracionMinutos: parseInt(row[6]) || 30,
                linkMeet: row[7] || ''
            })).filter(d => d.name && d.calendarId)

            return docentes
        } catch (error) {
            console.error('❌ Error al obtener docentes:', error)
            return []
        }
    }

    async getDocentesByStudent(studentId) {
        try {
            const student = await this.getStudentById(studentId)
            if (!student || !student.docentesAsignados) return []

            // Parsear formato "Nombre-Materia, Nombre-Materia"
            const docentesStr = student.docentesAsignados
            const docentesList = docentesStr.split(',').map(d => d.trim()).filter(d => d)

            const result = []
            for (const entry of docentesList) {
                const parts = entry.split('-')
                const nombreDocente = parts[0]?.trim() || ''
                const materia = parts[1]?.trim() || ''
                if (nombreDocente) {
                    result.push({ nombre: nombreDocente, materia })
                }
            }
            return result
        } catch (error) {
            console.error('❌ Error al obtener docentes del estudiante:', error)
            return []
        }
    }

    async findDocenteByPartialName(searchText) {
        const docentes = await this.getDocentes()
        const searchLower = searchText.toLowerCase().trim()

        // Buscar coincidencia exacta primero
        let found = docentes.find(d => d.name.toLowerCase() === searchLower)
        if (found) return found

        // Buscar si el nombre contiene el texto
        found = docentes.find(d => d.name.toLowerCase().includes(searchLower))
        if (found) return found

        // Buscar por número (1, 2, 3...)
        const num = parseInt(searchText)
        if (!isNaN(num) && num > 0 && num <= docentes.length) {
            return docentes[num - 1]
        }

        // Buscar si alguna palabra del nombre coincide
        found = docentes.find(d => {
            const words = d.name.toLowerCase().split(' ')
            return words.some(word => word.startsWith(searchLower))
        })

        return found || null
    }

    async getDocenteAvailableDays(docenteName) {
        const docentes = await this.getDocentes()
        const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
        if (!docente || !docente.diasDisponibles) return []
        return docente.diasDisponibles.split(',').map(d => d.trim()).filter(d => d)
    }

    async getDocenteAvailableHours(docenteName, selectedDay) {
        const docentes = await this.getDocentes()
        const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
        if (!docente || !docente.horariosDisponibles) return { horarios: [], duracionMinutos: 30 }

        const duracionMinutos = docente.duracionMinutos || 30

        // Obtener rango de horarios del Sheets (ej: "08:00-12:00,14:00-17:00" o "08:00,09:00,10:00")
        const horariosRaw = docente.horariosDisponibles.split(',').map(h => h.trim()).filter(h => h)

        // Generar slots basados en duración
        let slotsGenerados = []
        for (const horario of horariosRaw) {
            if (horario.includes('-')) {
                // Formato rango: "08:00-12:00"
                const [inicio, fin] = horario.split('-').map(h => h.trim())
                const [startH, startM] = inicio.split(':').map(Number)
                const [endH, endM] = fin.split(':').map(Number)
                let currentMin = startH * 60 + startM
                const endMin = endH * 60 + endM
                while (currentMin + duracionMinutos <= endMin) {
                    const hh = String(Math.floor(currentMin / 60)).padStart(2, '0')
                    const mm = String(currentMin % 60).padStart(2, '0')
                    slotsGenerados.push(`${hh}:${mm}`)
                    currentMin += duracionMinutos
                }
            } else {
                // Formato individual: "08:00"
                slotsGenerados.push(horario)
            }
        }

        // Combinar con disponibilidad del Calendar para ese día
        if (docente.calendarId && slotsGenerados.length > 0) {
            try {
                const dayDate = this.getNextDayDate(selectedDay)
                const startWindow = new Date(`${dayDate}T00:00:00`).toISOString()
                const endWindow = new Date(`${dayDate}T23:59:59`).toISOString()

                // Obtener eventos OCUPADOS del calendario
                const busySlots = await this.getBusySlots(docente.calendarId, startWindow, endWindow)

                // Filtrar horarios que NO estén ocupados
                const horariosLibres = slotsGenerados.filter(hora => {
                    const slotStartTime = new Date(`${dayDate}T${hora}:00`).getTime()
                    const slotEndTime = slotStartTime + (duracionMinutos * 60 * 1000)

                    // Verificar que no haya conflicto con ningún evento ocupado
                    const isOcupado = busySlots.some(busy => {
                        const busyStart = new Date(busy.start).getTime()
                        const busyEnd = new Date(busy.end).getTime()
                        // Hay conflicto si los rangos se solapan
                        return slotStartTime < busyEnd && slotEndTime > busyStart
                    })
                    return !isOcupado
                })

                return {
                    horarios: horariosLibres.length > 0 ? horariosLibres : slotsGenerados,
                    duracionMinutos
                }
            } catch (e) {
                console.log('⚠️ No se pudo verificar Calendar, usando horarios generados')
                return { horarios: slotsGenerados, duracionMinutos }
            }
        }
        return { horarios: slotsGenerados, duracionMinutos }
    }

    getNextDayDate(dayName) {
        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
        const dayLower = dayName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

        // Si ya es formato ISO (YYYY-MM-DD), devolverla directamente
        const isoMatch = dayName.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (isoMatch) {
            return dayName
        }

        // Si ya es una fecha (contiene número), devolverla procesada
        const dateMatch = dayName.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/)
        if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0')
            const month = dateMatch[2].padStart(2, '0')
            const year = dateMatch[3] || new Date().getFullYear()
            return `${year}-${month}-${day}`
        }

        const targetDay = days.findIndex(d => d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith(dayLower))

        const today = new Date()
        const currentDay = today.getDay()
        let daysUntil = targetDay - currentDay
        if (daysUntil <= 0) daysUntil += 7

        const targetDate = new Date(today.getTime() + daysUntil * 24 * 60 * 60 * 1000)
        return targetDate.toISOString().slice(0, 10)
    }

    // Generar fechas concretas disponibles basadas en los días de la semana configurados
    async getDocenteAvailableDates(docenteName, weeksAhead = 4) {
        const docentes = await this.getDocentes()
        const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
        if (!docente || !docente.diasDisponibles) return []

        const diasSemana = docente.diasDisponibles.split(',').map(d => d.trim()).filter(d => d)
        const daysMap = {
            'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
            'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6
        }

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const availableDates = []

        // Generar fechas para las próximas N semanas
        const endDate = new Date(today.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000)
        let currentDate = new Date(today.getTime())

        // Empezar desde mañana si hoy ya pasó cierta hora (ej: después de las 17:00)
        if (new Date().getHours() >= 17) {
            currentDate = new Date(today.getTime() + 24 * 60 * 60 * 1000)
        }

        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay()

            for (const diaNombre of diasSemana) {
                const diaLower = diaNombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                const targetDayNum = daysMap[diaLower]

                if (targetDayNum !== undefined && dayOfWeek === targetDayNum) {
                    const dateStr = currentDate.toISOString().slice(0, 10)
                    const dayName = diaNombre
                    const dayNum = currentDate.getDate()
                    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
                    const monthName = monthNames[currentDate.getMonth()]

                    availableDates.push({
                        date: dateStr,
                        display: `${dayName} ${dayNum} ${monthName}`,
                        dayName: dayName,
                        dayNum: dayNum,
                        month: monthName
                    })
                    break
                }
            }

            currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
        }

        // Limitar a máximo 10 fechas para no abrumar
        return availableDates.slice(0, 10)
    }

    // Buscar fecha por texto flexible (puede ser "Lunes", "9", "Lunes 9", "9 Dic", etc)
    findDateByText(availableDates, searchText) {
        const searchLower = searchText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

        // Buscar coincidencia exacta del display
        let found = availableDates.find(d =>
            d.display.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === searchLower
        )
        if (found) return found

        // Buscar por número de día
        const numMatch = searchText.match(/(\d{1,2})/)
        if (numMatch) {
            const dayNum = parseInt(numMatch[1])
            found = availableDates.find(d => d.dayNum === dayNum)
            if (found) return found
        }

        // Buscar por nombre del día
        found = availableDates.find(d =>
            d.dayName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(searchLower) ||
            searchLower.includes(d.dayName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        )
        if (found) return found

        // Buscar por índice (1, 2, 3...)
        const idx = parseInt(searchText) - 1
        if (!isNaN(idx) && idx >= 0 && idx < availableDates.length) {
            return availableDates[idx]
        }

        return null
    }

    async getDocenteModalidades(docenteName) {
        const docentes = await this.getDocentes()
        const docente = docentes.find(d => d.name.toLowerCase() === docenteName.toLowerCase())
        if (!docente || !docente.modalidad) return []
        return docente.modalidad.split(',').map(m => m.trim()).filter(m => m)
    }

    // === CONFIGURACIÓN DINÁMICA DE FORMULARIO ===

    async ensureFormConfigSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('Configuracion_Formulario')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'Configuracion_Formulario'
                                }
                            }
                        }]
                    }
                })
                // Agregar estructura inicial
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Configuracion_Formulario!A1:D1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['Campo_ID', 'Pregunta', 'Obligatorio', 'Orden']]
                    }
                })
                // Datos de ejemplo
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Configuracion_Formulario!A2:D5',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [
                            ['nombre', '👤 ¿Cuál es tu nombre completo?', 'SI', '1'],
                            ['documento', '📄 ¿Cuál es tu número de documento (cédula/DNI)?', 'SI', '2'],
                            ['email', '📧 ¿Cuál es tu email? (Requerido para confirmación)', 'SI', '3'],
                            ['objetivo', '🎯 ¿Cuál es el motivo de la cita? (ej: rendimiento académico)', 'SI', '4']
                        ]
                    }
                })
                // Pie de mensaje
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Configuracion_Formulario!F1:G2',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [
                            ['Configuracion', 'Valor'],
                            ['Pie_Confirmacion', '⏱️ Recuerda disponer de tiempo aproximado de 1 hora.\n\nRecibirás recordatorios en este WhatsApp. ¡Nos vemos!']
                        ]
                    }
                })
                console.log('✅ Hoja Configuracion_Formulario creada')
            } else {
                console.log('✅ Hoja Configuracion_Formulario ya existe')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja Configuracion_Formulario:', error)
        }
    }

    async getFormFields() {
        try {
            // Consulta en tiempo real - campos 100% dinámicos desde Sheets
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Configuracion_Formulario!A2:D'
            })
            const rows = response.data.values || []
            return rows
                .map(row => ({
                    id: row[0] || '',
                    pregunta: row[1] || '',
                    obligatorio: (row[2] || '').toUpperCase() === 'SI',
                    orden: parseInt(row[3]) || 999
                }))
                .filter(f => f.id && f.pregunta)
                .sort((a, b) => a.orden - b.orden)
        } catch (error) {
            console.error('❌ Error al obtener campos del formulario:', error)
            // Sin campos por defecto - todo viene de Sheets
            return []
        }
    }

    async getConfirmationFooter() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Configuracion_Formulario!G2'
            })
            const value = response.data.values?.[0]?.[0]
            return value || '⏱️ Recuerda disponer de tiempo aproximado de 1 hora.\n\nRecibirás recordatorios en este WhatsApp. ¡Nos vemos!'
        } catch (error) {
            console.error('❌ Error al obtener pie de confirmación:', error)
            return '⏱️ Recuerda disponer de tiempo aproximado de 1 hora.\n\nRecibirás recordatorios en este WhatsApp. ¡Nos vemos!'
        }
    }

    // NOTA: Funciones getInstructors, getActiveInstructors, findInstructorByPartialName eliminadas
    // Se usan las funciones de Docentes: getDocentes, findDocenteByPartialName

    // === FUNCIONES PARA GESTIÓN DE CITAS ===

    async ensureAppointmentsSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('Citas_Registradas')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'Citas_Registradas'
                                }
                            }
                        }]
                    }
                })
                // Agregar headers
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Citas_Registradas!A1:L1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[
                            'ID_Cita',
                            'Fecha_Creacion',
                            'WhatsApp',
                            'Nombre_Cliente',
                            'Num_Documento',
                            'Email',
                            'Objetivo',
                            'Entrenador',
                            'Fecha_Cita',
                            'Hora',
                            'Estado',
                            'Event_ID'
                        ]]
                    }
                })
                console.log('✅ Hoja Citas_Registradas creada')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja Citas_Registradas:', error)
        }
    }

    async getNextAppointmentId() {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Citas_Registradas!A2:A'
            })
            const rows = response.data.values || []
            if (rows.length === 0) return 1
            const lastId = parseInt(rows[rows.length - 1][0]) || 0
            return lastId + 1
        } catch (error) {
            console.error('❌ Error al obtener siguiente ID de cita:', error)
            return 1
        }
    }

    async saveAppointmentToSheet(appointmentData) {
        try {
            // 1. Obtener campos dinámicos configurados
            const dynamicFields = await this.getFormFields()

            // 2. Definir campos del sistema (fijos)
            const systemFields = [
                { id: 'id_cita', header: 'ID_Cita' },
                { id: 'fecha_registro', header: 'Fecha_Registro' },
                { id: 'whatsapp', header: 'WhatsApp' },
                { id: 'estudiante', header: 'Estudiante' },
                { id: 'id_estudiante', header: 'ID_Estudiante' },
                { id: 'entrenador', header: 'Docente' },
                { id: 'fecha_cita', header: 'Fecha_Cita' },
                { id: 'hora_cita', header: 'Hora_Cita' },
                { id: 'estado', header: 'Estado' },
                { id: 'event_id', header: 'EventID' }
            ]

            // 3. Construir headers completos (Sistema + Dinámicos)
            const allHeaders = [...systemFields.map(f => f.header), ...dynamicFields.map(f => f.id)]

            // 4. Actualizar headers en la hoja (asegurar que coincidan con la configuración actual)
            // Calculamos la letra de la última columna (ej: 8 fijos + 3 dinámicos = 11 -> K)
            const lastColChar = String.fromCharCode(65 + allHeaders.length - 1)
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.sheetId,
                range: `Citas_Registradas!A1:${lastColChar}1`,
                valueInputOption: 'RAW',
                resource: { values: [allHeaders] }
            })

            // 5. Preparar datos para guardar
            const nextId = await this.getNextAppointmentId()
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

            // Mapear datos del sistema
            const systemValues = [
                nextId,
                now,
                appointmentData.whatsapp,
                appointmentData.studentName || '',
                appointmentData.studentId || '',
                appointmentData.entrenador,
                appointmentData.fecha,
                appointmentData.hora,
                appointmentData.estado || 'Confirmada',
                appointmentData.eventId || ''
            ]

            // Mapear datos dinámicos (buscar en appointmentData por el ID del campo)
            const dynamicValues = dynamicFields.map(field => {
                const val = appointmentData[field.id] || appointmentData.dynamicData?.[field.id] || ''
                return val
            })

            const row = [...systemValues, ...dynamicValues]

            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.sheetId,
                range: 'Citas_Registradas!A2', // Append buscará la primera fila vacía
                valueInputOption: 'RAW',
                resource: {
                    values: [row]
                }
            })

            console.log(`✅ Cita guardada dinámica - ID: ${nextId}`)
            return nextId
        } catch (error) {
            console.error('❌ Error al guardar cita dinámica:', error)
            throw error
        }
    }


    async getAppointmentsByPhone(phoneNumber) {
        try {
            // Nueva estructura de columnas (10 fijas + dinámicas):
            // 0=ID_Cita, 1=Fecha_Registro, 2=WhatsApp, 3=Estudiante, 4=ID_Estudiante,
            // 5=Docente, 6=Fecha_Cita, 7=Hora_Cita, 8=Estado, 9=EventID, 10+=dinámicos
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Citas_Registradas!A2:Z'
            })
            const rows = response.data.values || []

            const appointments = rows
                .filter(row => {
                    const rowPhone = row[2] || ''
                    return rowPhone === phoneNumber || rowPhone.includes(phoneNumber) || phoneNumber.includes(rowPhone)
                })
                .map(row => ({
                    id: row[0] || '',
                    fechaCreacion: row[1] || '',
                    whatsapp: row[2] || '',
                    estudiante: row[3] || '',
                    idEstudiante: row[4] || '',
                    docente: row[5] || '',
                    fechaCita: row[6] || '',
                    hora: row[7] || '',
                    estado: row[8] || '',
                    eventId: row[9] || ''
                }))

            // Filtrar solo confirmadas/reprogramadas
            const filtered = appointments.filter(apt =>
                apt.estado === 'Confirmada' || apt.estado === 'Reprogramada'
            )
            return filtered
        } catch (error) {
            console.error('❌ Error al obtener citas por teléfono:', error)
            return []
        }
    }

    async updateAppointmentStatus(appointmentId, newStatus) {
        try {
            // Nueva estructura: Estado está en columna I (índice 8)
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Citas_Registradas!A2:J'
            })
            const rows = response.data.values || []
            const rowIndex = rows.findIndex(row => row[0] === String(appointmentId))

            if (rowIndex === -1) {
                console.log(`⚠️ Cita ID ${appointmentId} no encontrada`)
                return false
            }

            // Actualizar estado (columna I, índice 8)
            const sheetRow = rowIndex + 2 // +2 porque empezamos en A2
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.sheetId,
                range: `Citas_Registradas!I${sheetRow}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[newStatus]]
                }
            })

            console.log(`✅ Estado de cita ${appointmentId} actualizado a: ${newStatus}`)
            return true
        } catch (error) {
            console.error('❌ Error al actualizar estado de cita:', error)
            return false
        }
    }

    // === FUNCIONES PARA MENSAJE DE BIENVENIDA ===

    async ensureBienvenidaSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('Bienvenida')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'Bienvenida'
                                }
                            }
                        }]
                    }
                })
                // Agregar headers
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Bienvenida!A1:I1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[
                            'ID',
                            'Bienvenida_Text',
                            'Url_Media',
                            '',
                            '',
                            'NumeroWhatsapp',
                            'Fecha_Envio',
                            'Contador',
                            'Estado'
                        ]]
                    }
                })
                console.log('✅ Hoja Bienvenida creada')
            } else {
                console.log('✅ Hoja Bienvenida ya existe')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja Bienvenida:', error)
        }
    }

    async getWelcomeMessage() {
        try {
            // Consulta en tiempo real para obtener el mensaje actualizado
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Bienvenida!A2:C2'
            })
            const row = response.data.values?.[0]
            if (!row) return null
            return {
                id: row[0] || '1',
                text: row[1] || null,
                mediaUrl: row[2] || null
            }
        } catch (error) {
            console.error('❌ Error al obtener mensaje de bienvenida:', error)
            return null
        }
    }

    async getWelcomeControlByPhone(phoneNumber) {
        try {
            // Consulta en tiempo real para verificar estado actualizado
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Bienvenida!F2:I'
            })
            const rows = response.data.values || []
            const rowIndex = rows.findIndex(row => row[0] === phoneNumber)
            if (rowIndex === -1) return null
            const row = rows[rowIndex]
            return {
                rowIndex: rowIndex + 2, // +2 porque empezamos en F2
                phoneNumber: row[0],
                fechaEnvio: row[1],
                contador: parseInt(row[2]) || 0,
                estado: row[3] || 'ACTIVO'
            }
        } catch (error) {
            console.error('❌ Error al obtener control de bienvenida:', error)
            return null
        }
    }

    async shouldSendWelcome(phoneNumber) {
        const control = await this.getWelcomeControlByPhone(phoneNumber)

        if (!control) {
            // Usuario nuevo, debe enviar bienvenida
            return { shouldSend: true, isNew: true }
        }

        // Verificar si han pasado 24 horas
        const lastSent = new Date(control.fechaEnvio)
        const now = new Date()
        const hoursDiff = (now - lastSent) / (1000 * 60 * 60)

        if (hoursDiff >= 24) {
            // Han pasado 24+ horas, enviar y actualizar
            return { shouldSend: true, isNew: false, rowIndex: control.rowIndex, contador: control.contador }
        }

        // Menos de 24 horas, no enviar
        return { shouldSend: false }
    }

    async updateWelcomeControl(phoneNumber, isNew, existingData = null) {
        try {
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

            if (isNew) {
                // Agregar nueva fila
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.sheetId,
                    range: 'Bienvenida!F2:I',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[phoneNumber, now, 1, 'PAUSADO']]
                    }
                })
                console.log(`✅ Registro de bienvenida creado para ${phoneNumber}`)
            } else if (existingData) {
                // Actualizar fila existente
                const newContador = (existingData.contador || 0) + 1
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: `Bienvenida!F${existingData.rowIndex}:I${existingData.rowIndex}`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[phoneNumber, now, newContador, 'PAUSADO']]
                    }
                })
                console.log(`✅ Registro de bienvenida actualizado para ${phoneNumber} (envío #${newContador})`)
            }
            return true
        } catch (error) {
            console.error('❌ Error al actualizar control de bienvenida:', error)
            return false
        }
    }

    // === FUNCIONES PARA BLACKLIST ===

    async ensureBlacklistSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)
            if (!sheets.includes('BlackList')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: 'BlackList'
                                }
                            }
                        }]
                    }
                })
                // Agregar header
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'BlackList!A1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['NumeroWhatsapp']]
                    }
                })
                console.log('✅ Hoja BlackList creada')
            } else {
                console.log('✅ Hoja BlackList ya existe')
            }
        } catch (error) {
            console.error('❌ Error al crear hoja BlackList:', error)
        }
    }

    async getBlacklist() {
        try {
            // SIEMPRE consultar en tiempo real (sin caché) para intervención humana inmediata
            console.log('🔄 Consultando BlackList en tiempo real...')
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'BlackList!A2:A'
            })
            const rows = response.data.values || []
            return rows.map(row => row[0]).filter(num => num)
        } catch (error) {
            console.error('❌ Error al obtener blacklist:', error)
            return []
        }
    }

    async isBlacklisted(phoneNumber) {
        try {
            const blacklist = await this.getBlacklist()
            // Normalizar número (quitar caracteres especiales)
            const normalizedPhone = phoneNumber.replace(/[^0-9]/g, '')
            const isBlocked = blacklist.some(blockedNum => {
                const normalizedBlocked = blockedNum.replace(/[^0-9]/g, '')
                return normalizedPhone === normalizedBlocked ||
                    normalizedPhone.endsWith(normalizedBlocked) ||
                    normalizedBlocked.endsWith(normalizedPhone)
            })
            return isBlocked
        } catch (error) {
            console.error('❌ Error al verificar blacklist:', error)
            return false
        }
    }

    async ensureEnviosSheet() {
        try {
            const spreadsheet = await this.sheets.spreadsheets.get({
                spreadsheetId: this.sheetId
            })
            const sheets = spreadsheet.data.sheets.map(s => s.properties.title)

            if (!sheets.includes('Envios')) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: {
                        requests: [{
                            addSheet: {
                                properties: { title: 'Envios' }
                            }
                        }]
                    }
                })
                // Agregar headers
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: 'Envios!A1:E1',
                    valueInputOption: 'RAW',
                    resource: {
                        values: [['NumeroWhatsapp', 'MensajeTexto', 'MediaUrl', 'Hora', 'Estado']]
                    }
                })
                console.log('✅ Hoja Envios creada')
            } else {
                // Verificar que la columna Estado exista (columna E)
                const headers = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.sheetId,
                    range: 'Envios!A1:E1'
                })
                const headerValues = headers.data.values?.[0] || []

                if (!headerValues[4] || headerValues[4] !== 'Estado') {
                    // Agregar columna Estado
                    await this.sheets.spreadsheets.values.update({
                        spreadsheetId: this.sheetId,
                        range: 'Envios!E1',
                        valueInputOption: 'RAW',
                        resource: { values: [['Estado']] }
                    })
                    console.log('✅ Columna Estado agregada a Envios')
                }
            }
        } catch (error) {
            console.error('❌ Error al crear/verificar hoja Envios:', error.message)
        }
    }
}

const googleService = new GoogleService()
export default googleService
