# 📱 Manual de Usuario - Sistema de Citas Escolares por WhatsApp

## ¿Qué es este sistema?

Es un **asistente virtual de WhatsApp** que permite a los padres de familia agendar citas con los docentes de forma automática, las 24 horas del día, los 7 días de la semana.

---

## 🎯 Funcionalidades Principales

### 1. 📅 Agendamiento de Citas
Los padres pueden agendar citas con docentes directamente desde WhatsApp, eligiendo:
- El docente con quien desean reunirse
- Modalidad: Virtual o Presencial
- Fecha y hora según disponibilidad real

### 2. 🤖 Asistente Inteligente
El bot entiende el lenguaje natural y puede responder preguntas generales sobre el colegio.

### 3. 📨 Mensajes Programados
Envío automático de recordatorios y comunicaciones a los padres.

### 4. 📋 Respuestas Automáticas
Respuestas predefinidas para preguntas frecuentes como horarios, ubicación, etc.

---

## 📲 Cómo Agendar una Cita (Paso a Paso)

### Paso 1: Iniciar Conversación
Envía un mensaje como:
> "Hola, quiero agendar una cita"

### Paso 2: Identificación del Estudiante
El bot te pedirá el **número de documento** del estudiante.

![Paso 1](https://via.placeholder.com/400x200?text=Ingresa+ID+Estudiante)

### Paso 3: Seleccionar Docente
Verás la lista de docentes asignados al estudiante:
```
👨‍🏫 Docentes asignados:
1. María García - Matemáticas
2. Juan Pérez - Español
3. Ana López - Coordinadora

❓ ¿Con cuál docente deseas agendar?
```
Responde con el **número** o **nombre** del docente.

### Paso 4: Elegir Modalidad
Si el docente ofrece ambas opciones:
```
¿Cómo prefieres la cita?
1. Virtual
2. Presencial
```

### Paso 5: Seleccionar Fecha
El bot mostrará las fechas disponibles:
```
📅 Fechas disponibles:
1. Lunes 16 Dic
2. Miércoles 18 Dic
3. Viernes 20 Dic
```

### Paso 6: Elegir Hora
Verás los horarios libres según el calendario del docente:
```
⏰ Horarios disponibles:
• 02:00 PM
• 03:00 PM
• 04:00 PM
```
Puedes escribir "2 PM" o "14:00".

### Paso 7: Datos Adicionales
El bot te pedirá información como:
- Nombre del acudiente
- Motivo de la cita

### Paso 8: ¡Confirmación!
Recibirás un mensaje con todos los detalles:
```
✅ ¡Cita Agendada Exitosamente!

👨‍🏫 Docente: María García
📚 Materia: Matemáticas
💻 Modalidad: Virtual

📅 Fecha: Lunes 16 Dic
⏰ Hora: 02:00 PM

📹 Reunión Virtual:
https://meet.google.com/abc-def-ghi
```

---

## 📊 Configuración desde Google Sheets

### Hoja: Estudiantes
Contiene la información de cada estudiante:

| ID_Estudiante | Nombre | Grado | Curso | Jornada | Docentes_Asignados |
|---------------|--------|-------|-------|---------|-------------------|
| 12345 | Juan Pérez | 11 | 1102 | Mañana | María-Matemáticas, Juan-Español |

### Hoja: Docentes
Configuración de cada docente:

| Nombre | CalendarId | Materia | Modalidad | DíasDisponibles | Horarios | Duración | Link_Meet |
|--------|------------|---------|-----------|-----------------|----------|----------|-----------|
| María García | maria@... | Matemáticas | Virtual,Presencial | Lunes,Miércoles | 14:00,15:00,16:00 | 20 | https://meet... |

### Hoja: Flujos
Respuestas automáticas por palabra clave:

| Palabra Clave | Respuesta | Media (opcional) |
|---------------|-----------|------------------|
| horarios | El colegio atiende de 7am a 5pm | |
| ubicacion | Estamos en Calle 123 #45-67 | https://maps... |

### Hoja: Envios
Mensajes programados:

| NumeroWhatsapp | MensajeTexto | MediaUrl | Hora | Estado |
|----------------|--------------|----------|------|--------|
| 573001234567 | Recordatorio de cita mañana | | 15/12/2025 7:00:00 | Pendiente |

### Hoja: BlackList
Números bloqueados que no recibirán respuesta:

| NumeroWhatsapp |
|----------------|
| 573009999999 |

---

## ⚙️ Panel de Control

### Agregar un Estudiante Nuevo
1. Abrir Google Sheets
2. Ir a hoja **Estudiantes**
3. Agregar fila con: ID, Nombre, Grado, Curso, Jornada, Docentes

### Agregar un Docente Nuevo
1. Ir a hoja **Docentes**
2. Agregar fila con todos los datos
3. **Importante:** El CalendarId debe ser el correo del calendario del docente

### Programar un Mensaje
1. Ir a hoja **Envios**
2. Agregar fila:
   - Número WhatsApp (con código de país: 573...)
   - Texto del mensaje
   - URL de archivo (opcional)
   - Fecha y hora: DD/MM/YYYY HH:mm:ss
   - Estado: **Pendiente**

### Bloquear un Número
1. Ir a hoja **BlackList**
2. Agregar el número con código de país

---

## 🔒 Seguridad

- **Links de Meet personalizados:** Cada docente tiene su propia sala de reuniones
- **Sala de espera:** El docente admite a los participantes manualmente
- **Blacklist:** Números problemáticos pueden ser bloqueados inmediatamente

---

## 📈 Límites y Protecciones

| Protección | Descripción |
|------------|-------------|
| Mensajes diarios | Máximo 50 mensajes programados por día |
| Horario de envío | Solo entre 6:00 AM y 9:00 PM |
| Delay entre mensajes | 5-15 segundos aleatorio |

---

## ❓ Preguntas Frecuentes

### ¿Qué pasa si el padre escribe mal el ID?
El bot le dará 3 intentos antes de cancelar el proceso.

### ¿Se puede reprogramar una cita?
Sí, el padre puede escribir "reprogramar cita" para gestionar citas existentes.

### ¿Cómo sé si el mensaje programado se envió?
En la columna **Estado** de la hoja Envios cambiará de "Pendiente" a "Enviado".

### ¿Qué pasa si la hora del docente no está disponible?
El bot verifica el calendario real de Google Calendar y solo muestra horarios libres.

---

## 🆘 Soporte Técnico

Para problemas técnicos, contactar al administrador del sistema con:
- Captura de pantalla del error
- Número de WhatsApp del usuario
- Fecha y hora del problema
