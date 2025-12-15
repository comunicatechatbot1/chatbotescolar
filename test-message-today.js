// Script para crear un mensaje de prueba para hoy
import 'dotenv/config'
import googleSheetService from './src/sheets.js'

async function createTestMessage() {
    try {
        const now = new Date()
        const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
        const futureTime = new Date(now.getTime() + 2 * 60000) // +2 minutos
        const testTime = futureTime.toTimeString().substring(0, 5) // HH:MM
        
        console.log('📅 Creando mensaje de prueba para:')
        console.log('  - Fecha:', currentDate)
        console.log('  - Hora:', testTime)
        console.log('  - Hora actual:', now.toTimeString().substring(0, 5))
        
        console.log('\n⚠️ INSTRUCCIONES:')
        console.log('1. Ve a Google Sheets')
        console.log('2. En la hoja "Mensajes_Programados", agrega una nueva fila:')
        console.log(`   - Fecha: ${currentDate}`)
        console.log(`   - Hora: ${testTime}`)
        console.log('   - phone: 573017474717')
        console.log('   - addAnswer: Mensaje de prueba automático')
        console.log('   - media: (dejar vacío)')
        console.log('   - Estado: (dejar vacío o "Pendiente")')
        console.log('3. Guarda los cambios')
        console.log('4. Ejecuta el bot y espera 2 minutos')
        
    } catch (error) {
        console.error('❌ Error:', error)
    }
}

createTestMessage()