import { config } from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { CohereClient } from 'cohere-ai';

config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => console.error('Error al conectar a MongoDB:', err));

const { Schema } = mongoose;
const recetaSchema = new Schema({
  nombre: { type: String, required: true },
  ingredientes: { type: [String], required: true },
  instrucciones: { type: String, required: true }
});
const Receta = mongoose.models.Receta || mongoose.model('Receta', recetaSchema);

const usuarioSchema = new Schema({
  userId: { type: Number, required: true, unique: true },
  favoritos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Receta' }],
});
const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);

const telegramBot = new TelegramBot(process.env.TELEGRAM_API_KEY);

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const isAdmin = (msg) => msg.from.id === parseInt(process.env.ADMIN_ID);

async function generateResponse(question) {
  try {
    const response = await cohere.generate({
      model: 'command', 
      prompt: question,
    });
    if (response && response.generations && response.generations.length > 0) {
      return response.generations[0].text.trim();
    } else {
      return 'Lo siento, no pude generar una respuesta.';
    }
  } catch (error) {
    return 'Lo siento, hubo un error al procesar tu pregunta.';
  }
}

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


export default async function handler(req, res) {

  if (req.method === 'POST') {
    const msg = req.body.message || {};
    const chatId = msg.chat?.id;

    // Verificar si el mensaje y el chatId existen
    if (!msg.chat || !msg.chat.id) {
      return res.status(400).send('Bad Request');
    }

    const messageText = msg.text?.trim().toLowerCase();

    // Responder a "Chef!"
    if (messageText === "chef!") {
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
      await telegramBot.sendMessage(chatId, "Kaixo sukaldari! ¿En qué te puedo ayudar?", options);
    }
    
    else if (messageText === "buscar recetas") {
      telegramBot.sendMessage(chatId, "Por favor, escribe el nombre de un ingrediente o receta que te gustaría buscar.");
    }
    
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
    
    else if (messageText.includes("pregunta")) {
      const userQuestion = messageText.replace(/pregunta/i, '').trim();

      if (userQuestion) {
        try {
          const response = await generateResponse(userQuestion);
          telegramBot.sendMessage(chatId, response);

          try {
            const newPreguntaFrecuente = new PreguntaFrecuente({
              pregunta: userQuestion,
              respuesta: response,
            });
            await newPreguntaFrecuente.save();
          } catch (dbError) {
            console.error('Error al guardar pregunta frecuente:', dbError);
          }

          sendFeedback(chatId);
        } catch (error) {
          telegramBot.sendMessage(chatId, 'Lo siento, ocurrió un error al consultar con Cohere. Intenta nuevamente más tarde.');
        }
      } else {
        telegramBot.sendMessage(chatId, "Por favor, haz una pregunta sobre cocina después de la palabra 'pregunta'.");
      }
    }
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

    else if (msg.callback_query) {
      const callbackData = msg.callback_query.data;
      if (callbackData.startsWith('add_fav_')) {
        const recetaId = callbackData.split('_')[2];
        const user = await Usuario.findOne({ userId: msg.from.id });
        if (user) {
          user.favoritos.push(recetaId);
          await user.save();
          telegramBot.answerCallbackQuery(msg.callback_query.id, 'Receta añadida a favoritos');
        }
      } else if (callbackData.startsWith('remove_fav_')) {
        const recetaId = callbackData.split('_')[2];
        const user = await Usuario.findOne({ userId: msg.from.id });
        if (user) {
          user.favoritos.pull(recetaId);
          await user.save();
          telegramBot.answerCallbackQuery(msg.callback_query.id, 'Receta eliminada de favoritos');
        }
      }
    }

    return res.status(200).send('OK'); 
  } else {
    return res.status(405).send('Method Not Allowed'); 
  }
}

async function setWebhook() {
  const webhookUrl = `${process.env.VERCEL_URL}/api/bot`;
  try {
    await telegramBot.setWebHook(webhookUrl);
  } catch (error) {
    console.error("Error al establecer el webhook:", error);
  }
}

setWebhook();