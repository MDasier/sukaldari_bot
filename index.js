require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const { CohereClient, CohereError, CohereTimeoutError } = require('cohere-ai');

// Conectar a MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB');
  }).catch(err => {
    console.error('Error al conectar a MongoDB:', err);
  });

// Crear esquema de receta en MongoDB
const { Schema } = mongoose;
const recetaSchema = new Schema({
  nombre: { type: String, required: true },
  ingredientes: { type: [String], required: true },
  instrucciones: { type: String, required: true }
});
const Receta = mongoose.model('Receta', recetaSchema);

// Crear esquema de usuario con favoritos
const usuarioSchema = new Schema({
  userId: { type: Number, required: true, unique: true },
  favoritos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Receta' }],
});
const Usuario = mongoose.model('Usuario', usuarioSchema);

// Esquema de Preguntas Frecuentes
const preguntaFrecuenteSchema = new Schema({
  pregunta: { type: String, required: true },
  respuesta: { type: String, required: true },
  cantidadConsultas: { type: Number, default: 1 }, // Cuántas veces se ha preguntado esta pregunta
});
const PreguntaFrecuente = mongoose.model('PreguntaFrecuente', preguntaFrecuenteSchema);

// Configuración del bot de Telegram
const telegramBot = new TelegramBot(process.env.TELEGRAM_API_KEY, { polling: true });

// Configuración de Cohere
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// Función para verificar si el usuario es administrador
const isAdmin = (msg) => msg.from.id === parseInt(process.env.ADMIN_ID);

// Función para enviar un mensaje de feedback con opciones
function sendFeedback(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Sí", callback_data: "feedback_yes" },
          { text: "No", callback_data: "feedback_no" }
        ]
      ]
    }
  };
  telegramBot.sendMessage(chatId, "¿Te ha sido útil esta respuesta?", options);
}

// Función para interactuar con Cohere (generación de texto, respuestas, etc.)
async function generateResponse(question) {
  try {
    const response = await cohere.generate({
      model: 'command', // Puedes elegir el modelo que más te convenga
      prompt: question, // La pregunta o texto que el usuario ha enviado
    });
    // Verificar que la respuesta tenga la estructura correcta
    if (response && response.generations && response.generations.length > 0) {
      // Acceder al primer texto generado
      const generatedText = response.generations[0].text.trim();
      
      // Si hay texto generado, devolverlo; si no, devolver mensaje de error
      return generatedText ? generatedText : 'Ha habido un error al generar la respuesta.';
    } else {
      return 'Lo siento, no pude generar una respuesta.';
    }
  } catch (error) {
    return 'Lo siento, hubo un error al procesar tu pregunta.';
  }
}

// Comando Chef!
telegramBot.onText(/Chef!/, (msg) => {
  const chatId = msg.chat.id;

  // Crear botones para las opciones
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: "Buscar Recetas" }],
        [{ text: "Agregar Receta" }],
        [{ text: "Preguntar sobre Cocina" }],
        [{ text: "Ver recetas favoritas" }],
        [{ text: "Ver todas las recetas" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };

  telegramBot.sendMessage(chatId, "Kaixo sukaldari! ¿En qué te puedo ayudar?", options);
});

// Responder a las opciones del menú
telegramBot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.text) return;

  const messageText = msg.text.trim().toLowerCase();

  // Responder a "Buscar Recetas"
  if (messageText === "buscar recetas") {
    telegramBot.sendMessage(chatId, "Por favor, escribe el nombre de un ingrediente o receta que te gustaría buscar.");
  } 
  // Responder a "Agregar Receta"
  else if (messageText === "agregar receta") {
    if (!isAdmin(msg)) {
      telegramBot.sendMessage(chatId, "No tienes permisos para agregar recetas.");
      return;
    }

    telegramBot.sendMessage(chatId, "¡Genial! Vamos a agregar una nueva receta. ¿Cómo se llama la receta?");
    telegramBot.once('message', (msg) => {
      const recetaNombre = msg.text;
      telegramBot.sendMessage(chatId, `Receta: ${recetaNombre}. Ahora, por favor, envíame los ingredientes (separados por coma, ej: "1 cebolla, 2 dientes de ajo"):`);

      telegramBot.once('message', (msg) => {
        const ingredientes = msg.text.split(',').map(ing => ing.trim());
        telegramBot.sendMessage(chatId, 'Perfecto. Ahora, ¿cuáles son las instrucciones para esta receta?');

        telegramBot.once('message', async (msg) => {
          const instrucciones = msg.text;

          // Guardar la receta en MongoDB
          const newReceta = new Receta({
            nombre: recetaNombre,
            ingredientes,
            instrucciones
          });

          try {
            await newReceta.save();
            telegramBot.sendMessage(chatId, `La receta "${recetaNombre}" se ha guardado correctamente.`);
          } catch (error) {
            telegramBot.sendMessage(chatId, 'Hubo un error al guardar la receta. Inténtalo más tarde.');
          }
        });
      });
    });
  } 
  
  // Preguntar sobre cocina
  else if (messageText.includes("pregunta")) {
    const userQuestion = messageText.replace(/pregunta/i, '').trim(); // Eliminar palabra "pregunta" y limpiar espacios

    if (userQuestion) {
      try {
        // Generar respuesta usando Cohere
        const response = await generateResponse(userQuestion);
        // Enviar respuesta al usuario
        telegramBot.sendMessage(chatId, response);

        // Guardar esta pregunta y respuesta en la base de datos
        try {
          const newPreguntaFrecuente = new PreguntaFrecuente({
            pregunta: userQuestion,
            respuesta: response,
          });
          await newPreguntaFrecuente.save();
        } catch (dbError) {
          console.error('Error al guardar pregunta frecuente:', dbError);
        }

        // Preguntar al usuario por feedback
        sendFeedback(chatId);
      } catch (error) {
        telegramBot.sendMessage(chatId, 'Lo siento, ocurrió un error al consultar con Cohere. Intenta nuevamente más tarde.');
      }
    } else {
      telegramBot.sendMessage(chatId, "Por favor, haz una pregunta sobre cocina después de la palabra 'pregunta'.");
    }
  }

  // Ver recetas favoritas
  else if (messageText === "ver recetas favoritas") {
    const user = await Usuario.findOne({ userId: msg.from.id });
    if (user && user.favoritos.length > 0) {
      const recetas = await Receta.find({ '_id': { $in: user.favoritos } });

      for (const receta of recetas) {
        // Crear botones para cada receta
        const inlineKeyboard = [
          [
            {
              text: "Eliminar de Favoritos",
              callback_data: `remove_fav_${receta._id}`,
            }
          ]
        ];

        // Enviar un mensaje para cada receta favorita
        await telegramBot.sendMessage(
          chatId,
          `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineKeyboard }
          }
        );
      }
    } else {
      telegramBot.sendMessage(chatId, "No tienes recetas favoritas guardadas.");
    }
  }

  // Ver todas las recetas
  else if (messageText === "ver todas las recetas") {
    const recetas = await Receta.find();
    if (recetas.length > 0) {
      recetas.forEach(async (receta) => {
        const inlineKeyboard = [
          [
            {
              text: "Añadir a Favoritos",
              callback_data: `add_fav_${receta._id}`,
            }
          ]
        ];

        await telegramBot.sendMessage(
          chatId,
          `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineKeyboard }
          }
        );
      });
    } else {
      telegramBot.sendMessage(chatId, "No hay recetas disponibles.");
    }
  }
});