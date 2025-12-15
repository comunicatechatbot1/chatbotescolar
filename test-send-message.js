// Script de prueba para verificar el envío de mensajes
import 'dotenv/config'
import scheduledMessageService from './src/scheduled-messages.js'

// Mock mejorado del bot que simula el comportamiento real
const mockBot = {
    sendMessage: async (phone, message, options) => {
        console.log('🔍 VERIFICANDO PARÁMETROS:')
        console.log('  📞 Teléfono:', phone)
        console.log('  💬 Mensaje:', message.substring(0, 50) + '...')
        console.log('  ⚙️ Options:', JSON.stringify(options))
        
        // Simular la validación que hace el provider real
        if (typeof options !== 'object') {
            throw new Error('Options debe ser un objeto')
        }
        
        if (options.hasOwnProperty('media')) {
            console.log('  🖼️ Media detectada:', options.media)
        }
        
        console.log('  ✅ Mensaje enviado exitosamente (simulado)')
        return { success: true }
    }
}

async function testSendMessage() {
    try {
        console.log('🧪 Probando envío de mensajes programados...')
        
        // Inicializar el servicio
        scheduledMessageService.initialize(mockBot)
        
        // Simular un mensaje programado sin media
        const messageWithoutMedia = {
            phone: '573017474717',
            addAnswer: 'Mensaje de prueba sin media',
            media: null,
            rowIndex: 1
        }
        
        console.log('\n📝 Probando mensaje SIN media:')
        await scheduledMessageService.sendScheduledMessage(messageWithoutMedia)
        
        // Simular un mensaje programado con media
        const messageWithMedia = {
            phone: '573017474717',
            addAnswer: 'Mensaje de prueba con media',
            media: 'https://example.com/image.jpg',
            rowIndex: 2
        }
        
        console.log('\n📝 Probando mensaje CON media:')
        await scheduledMessageService.sendScheduledMessage(messageWithMedia)
        
        console.log('\n✅ Todas las pruebas pasaron exitosamente')
        
    } catch (error) {
        console.error('❌ Error en la prueba:', error.message)
        console.error('Stack:', error.stack)
    }
}

// Ejecutar prueba
testSendMessage()
    .then(() => {
        console.log('\n🎉 Prueba de envío completada')
        process.exit(0)
    })
    .catch(error => {
        console.error('❌ Error fatal:', error)
        process.exit(1)
    })