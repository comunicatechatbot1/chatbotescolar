// Script de prueba completo para el sistema de mensajes programados
import 'dotenv/config'
import scheduledMessageService from './src/scheduled-messages.js'

// Mock del bot para pruebas
const mockBot = {
    sendMessage: async (phone, message, options = {}) => {
        console.log('📱 SIMULANDO ENVÍO DE MENSAJE:')
        console.log('  📞 Teléfono:', phone)
        console.log('  💬 Mensaje:', message.substring(0, 100) + (message.length > 100 ? '...' : ''))
        if (options.media) {
            console.log('  🖼️ Media:', options.media)
        }
        console.log('  ✅ Mensaje enviado exitosamente (simulado)')
        return { success: true }
    }
}

async function testScheduledSystem() {
    try {
        console.log('🧪 Iniciando prueba del sistema de mensajes programados...')
        
        // Inicializar el servicio con el mock del bot
        scheduledMessageService.initialize(mockBot)
        
        console.log('\n📊 Estadísticas iniciales:')
        const initialStats = await scheduledMessageService.getStats()
        console.log(initialStats)
        
        console.log('\n🔍 Ejecutando verificación forzada...')
        await scheduledMessageService.forceCheck()
        
        console.log('\n📊 Estadísticas finales:')
        const finalStats = await scheduledMessageService.getStats()
        console.log(finalStats)
        
        console.log('\n✅ Prueba completada')
        
    } catch (error) {
        console.error('❌ Error en la prueba:', error)
    }
}

// Ejecutar prueba
testScheduledSystem()
    .then(() => {
        console.log('\n🎉 Sistema de prueba finalizado')
        process.exit(0)
    })
    .catch(error => {
        console.error('❌ Error fatal en la prueba:', error)
        process.exit(1)
    })