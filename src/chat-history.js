import fs from 'fs/promises'
import path from 'path'

/**
 * @class ChatHistoryService
 * Esta clase maneja todo el historial de conversaciones del bot.
 * Guarda los mensajes en archivos JSON individuales por contacto
 * y proporciona métodos para recuperar el contexto relevante para la IA.
 */
class ChatHistoryService {
    constructor() {
        this.historyDir = path.join(process.cwd(), 'chat_history')
        this.maxMessages = 100
        this.retentionDays = 30
        this.contextMessages = 10
        
        this.ensureHistoryDir()
    }

    /**
     * Asegura que el directorio de historial existe
     */
    async ensureHistoryDir() {
        try {
            await fs.access(this.historyDir)
        } catch {
            await fs.mkdir(this.historyDir, { recursive: true })
            console.log('📁 Directorio de historial creado:', this.historyDir)
        }
    }

    /**
     * Obtiene la ruta del archivo de historial para un contacto
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @returns {string} Ruta del archivo
     */
    getHistoryFilePath(phoneNumber) {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '')
        return path.join(this.historyDir, `${cleanNumber}.json`)
    }

    /**
     * Carga el historial de un contacto
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @returns {Promise<Object>} Objeto con el historial del contacto
     */
    async loadHistory(phoneNumber) {
        const filePath = this.getHistoryFilePath(phoneNumber)
        
        try {
            const data = await fs.readFile(filePath, 'utf8')
            return JSON.parse(data)
        } catch (error) {
            return {
                phoneNumber,
                name: null,
                firstContact: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                messages: [],
                context: {
                    preferences: [],
                    topics: [],
                    summary: null
                },
                appointment: {
                    state: 'idle',
                    data: {}
                }
            }
        }
    }

    /**
     * Guarda el historial de un contacto
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @param {Object} history - Objeto con el historial
     */
    async saveHistory(phoneNumber, history) {
        const filePath = this.getHistoryFilePath(phoneNumber)
        
        history.lastActivity = new Date().toISOString()
        
        if (history.messages.length > this.maxMessages) {
            history.messages = history.messages.slice(-this.maxMessages)
        }
        
        try {
            await fs.writeFile(filePath, JSON.stringify(history, null, 2))
        } catch (error) {
            console.error('❌ Error al guardar historial:', error)
        }
    }

    /**
     * Guarda un nuevo mensaje en el historial
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @param {string} role - 'user' o 'assistant'
     * @param {string} content - Contenido del mensaje
     * @param {string} name - Nombre del contacto (opcional)
     */
    async saveMessage(phoneNumber, role, content, name = null) {
        const history = await this.loadHistory(phoneNumber)
        
        if (name && !history.name) {
            history.name = name
        }
        
        const message = {
            timestamp: new Date().toISOString(),
            role,
            content: content.trim()
        }
        
        history.messages.push(message)
        await this.saveHistory(phoneNumber, history)
        
        console.log(`💬 Mensaje guardado para ${phoneNumber}: ${role}`)
    }

    /**
     * Obtiene el contexto relevante para la IA
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @returns {Promise<Array>} Array de mensajes para el contexto de la IA
     */
    async getContextForAI(phoneNumber) {
        const history = await this.loadHistory(phoneNumber)
        const recentMessages = history.messages.slice(-this.contextMessages)
        const contextMessages = recentMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }))
        
        return contextMessages
    }

    /**
     * Obtiene un resumen del historial de un contacto
     * @param {string} phoneNumber - Número de teléfono del contacto
     * @returns {Promise<Object>} Resumen del historial
     */
    async getHistorySummary(phoneNumber) {
        const history = await this.loadHistory(phoneNumber)
        
        return {
            phoneNumber,
            name: history.name,
            firstContact: history.firstContact,
            lastActivity: history.lastActivity,
            totalMessages: history.messages.length,
            topics: history.context.topics,
            hasHistory: history.messages.length > 0
        }
    }

    /**
     * Limpia historiales antiguos
     * @returns {Promise<number>} Número de archivos eliminados
     */
    async cleanOldHistories() {
        try {
            const files = await fs.readdir(this.historyDir)
            const cutoffDate = new Date()
            cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays)
            
            let deletedCount = 0
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue
                
                const filePath = path.join(this.historyDir, file)
                const stats = await fs.stat(filePath)
                
                if (stats.mtime < cutoffDate) {
                    await fs.unlink(filePath)
                    deletedCount++
                    console.log(`🗑️ Historial eliminado: ${file}`)
                }
            }
            
            return deletedCount
        } catch (error) {
            console.error('❌ Error al limpiar historiales:', error)
            return 0
        }
    }

    /**
     * Obtiene estadísticas generales del historial
     * @returns {Promise<Object>} Estadísticas del historial
     */
    async getStats() {
        try {
            const files = await fs.readdir(this.historyDir)
            const jsonFiles = files.filter(f => f.endsWith('.json'))
            
            let totalMessages = 0
            let activeContacts = 0
            const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
            
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(this.historyDir, file)
                    const data = await fs.readFile(filePath, 'utf8')
                    const history = JSON.parse(data)
                    
                    totalMessages += history.messages.length
                    
                    if (new Date(history.lastActivity) > last24h) {
                        activeContacts++
                    }
                } catch {
                    continue
                }
            }
            
            return {
                totalContacts: jsonFiles.length,
                activeContacts,
                totalMessages,
                averageMessagesPerContact: jsonFiles.length > 0 ? Math.round(totalMessages / jsonFiles.length) : 0
            }
        } catch (error) {
            console.error('❌ Error al obtener estadísticas:', error)
            return {
                totalContacts: 0,
                activeContacts: 0,
                totalMessages: 0,
                averageMessagesPerContact: 0
            }
        }
    }

    async getAppointmentSession(phoneNumber) {
        const history = await this.loadHistory(phoneNumber)
        return history.appointment || { state: 'idle', data: {} }
    }

    async saveAppointmentSession(phoneNumber, session) {
        const filePath = this.getHistoryFilePath(phoneNumber)
        const history = await this.loadHistory(phoneNumber)
        history.appointment = session
        history.lastActivity = new Date().toISOString()
        await fs.writeFile(filePath, JSON.stringify(history, null, 2))
    }
}

const chatHistoryService = new ChatHistoryService()
export default chatHistoryService
