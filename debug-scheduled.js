// Script de depuración para mensajes programados
import 'dotenv/config'
import googleSheetService from './src/sheets.js'

// Función para depurar mensajes programados
async function debugScheduledMessages() {
    try {
        console.log('🔍 Iniciando depuración de mensajes programados...')
        
        // Obtener mensajes de Google Sheets
        const messages = await googleSheetService.getScheduledMessages()
        console.log('📊 Total de mensajes obtenidos:', messages.length)
        
        if (messages.length === 0) {
            console.log('❌ No se encontraron mensajes en Google Sheets')
            return
        }
        
        // Mostrar estructura de cada mensaje
        messages.forEach((message, index) => {
            console.log(`\n📝 Mensaje ${index + 1}:`)
            console.log('  - Fecha:', JSON.stringify(message.fecha))
            console.log('  - Hora:', JSON.stringify(message.hora))
            console.log('  - Teléfono:', JSON.stringify(message.phone))
            console.log('  - Estado:', JSON.stringify(message.estado))
            console.log('  - Mensaje:', JSON.stringify(message.addAnswer))
            console.log('  - Media:', JSON.stringify(message.media))
        })
        
        // Filtrar mensajes pendientes (nueva lógica)
        const pendingMessages = messages.filter(message => {
            const estado = message.estado?.toLowerCase().trim()
            // Considerar pendientes: null, undefined, vacío, o explícitamente "pendiente"
            return !estado || estado === '' || estado === 'pendiente'
        })
        
        console.log('\n📋 Mensajes pendientes:', pendingMessages.length)
        
        // Verificar fecha y hora actual
        const now = new Date()
        const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
        const currentTime = now.toTimeString().substring(0, 5) // HH:MM
        
        console.log('\n⏰ Fecha y hora actual:')
        console.log('  - Fecha actual:', currentDate)
        console.log('  - Hora actual:', currentTime)
        console.log('  - Timestamp completo:', now.toISOString())
        
        // Verificar cada mensaje pendiente
        pendingMessages.forEach((message, index) => {
            console.log(`\n🔍 Analizando mensaje pendiente ${index + 1}:`)
            
            const messageDate = message.fecha?.trim()
            const messageTime = message.hora?.trim()
            
            console.log('  - Fecha del mensaje:', messageDate)
            console.log('  - Hora del mensaje:', messageTime)
            console.log('  - ¿Fecha coincide?:', messageDate === currentDate)
            console.log('  - ¿Hora coincide?:', messageTime === currentTime)
            
            // Verificar si debe enviarse (lógica actual)
            const shouldSend = messageDate === currentDate && messageTime === currentTime
            console.log('  - ¿Debe enviarse ahora?:', shouldSend)
            
            // Verificar si debe enviarse (lógica mejorada - hasta 1 minuto de diferencia)
            if (messageDate === currentDate && messageTime) {
                const [msgHour, msgMin] = messageTime.split(':').map(Number)
                const [currHour, currMin] = currentTime.split(':').map(Number)
                
                const msgTotalMin = msgHour * 60 + msgMin
                const currTotalMin = currHour * 60 + currMin
                const diffMin = Math.abs(msgTotalMin - currTotalMin)
                
                console.log('  - Diferencia en minutos:', diffMin)
                console.log('  - ¿Debe enviarse (lógica mejorada)?:', diffMin <= 1)
            }
        })
        
    } catch (error) {
        console.error('❌ Error en depuración:', error)
    }
}

// Ejecutar depuración
debugScheduledMessages()
    .then(() => {
        console.log('\n✅ Depuración completada')
        process.exit(0)
    })
    .catch(error => {
        console.error('❌ Error fatal:', error)
        process.exit(1)
    })