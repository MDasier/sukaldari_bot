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
  instrucciones: { type: String, required: true },
  etiquetas: { type: [String], default: [] }
});
const Receta = mongoose.models.Receta || mongoose.model('Receta', recetaSchema);

const usuarioSchema = new Schema({
  userId: { type: Number, required: true, unique: true },
  favoritos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Receta' }],
});
const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', usuarioSchema);

const preguntaFrecuenteSchema = new Schema({
  pregunta: { type: String, required: true },
  respuesta: { type: String, required: true },
  cantidadConsultas: { type: Number, default: 1 },
});
const PreguntaFrecuente = mongoose.models.PreguntaFrecuente || mongoose.model('PreguntaFrecuente', preguntaFrecuenteSchema);

const telegramBot = new TelegramBot(process.env.TELEGRAM_API_KEY, { polling: false });

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const isAdmin = (msg) => msg.from?.id === parseInt(process.env.ADMIN_ID, 10);


async function generateResponse(question) {
  try {
    const response = await cohere.generate({
      model: 'command',
      prompt: question,
    });
    return response?.generations?.[0]?.text?.trim() || 'Lo siento, no pude generar una respuesta.';
  } catch (error) {
    console.error('Error al procesar pregunta con Cohere:', error);
    return 'Lo siento, hubo un error al procesar tu pregunta.';
  }
}


function sendFeedback(chatId) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Sí', callback_data: 'feedback_yes' },
          { text: 'No', callback_data: 'feedback_no' }
        ]
      ]
    }
  };
  telegramBot.sendMessage(chatId, '¿Te ha sido útil esta respuesta?', options);
}


export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { message, callback_query } = req.body;

    if (message) {
      const chatId = message.chat?.id;
      const messageText = message.text?.trim().toLowerCase();

      if (!chatId) return res.status(400).send('Bad Request');

      switch (messageText) {
        case 'chef!':
          await telegramBot.sendMessage(chatId, 'Kaixo sukaldari! ¿En qué te puedo ayudar?', {
            reply_markup: {
              keyboard: [
                [{ text: 'Buscar Recetas' }],
                [{ text: 'Añadir Receta' }],
                [{ text: 'Preguntar sobre Cocina' }],
                [{ text: 'Ver recetas favoritas' }],
                [{ text: 'Ver todas las recetas' }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          });
          break;

        case 'Buscar Recetas':
          await telegramBot.sendMessage(chatId, 'Escribe el nombre, ingrediente o etiqueta para buscar recetas:');
          telegramBot.once('message', async (msg) => {
            const searchTerm = msg.text.trim().toLowerCase();
            const recetas = await Receta.find({
              $or: [
                { nombre: { $regex: searchTerm, $options: 'i' } },
                { ingredientes: { $regex: searchTerm, $options: 'i' } },
                { etiquetas: { $regex: searchTerm, $options: 'i' } },
              ]
            });

            if (recetas.length > 0) {
              for (const receta of recetas) {
                await telegramBot.sendMessage(
                  chatId,
                  `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
                  { parse_mode: 'Markdown' }
                );
              }
            } else {
              await telegramBot.sendMessage(chatId, `No se encontraron recetas para "${searchTerm}".`);
            }
          });
          break;

        case 'Ver todas las recetas':
          const allRecetas = await Receta.find();
          if (allRecetas.length > 0) {
            for (const receta of allRecetas) {
              await telegramBot.sendMessage(
                chatId,
                `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
                { parse_mode: 'Markdown' }
              );
            }
          } else {
            await telegramBot.sendMessage(chatId, 'No hay recetas disponibles.');
          }
          break;

        case 'Ver recetas favoritas':
          const user = await Usuario.findOne({ userId: message.from.id });
          if (user && user.favoritos.length > 0) {
            const favoriteRecetas = await Receta.find({ _id: { $in: user.favoritos } });
            for (const receta of favoriteRecetas) {
              await telegramBot.sendMessage(
                chatId,
                `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
                { parse_mode: 'Markdown' }
              );
            }
          } else {
            await telegramBot.sendMessage(chatId, 'No tienes recetas favoritas guardadas.');
          }
          break;

        case 'Añadir Receta':
          if (!isAdmin(message)) {
            await telegramBot.sendMessage(chatId, 'No tienes permisos para agregar recetas.');
            return;
          }
  
            await telegramBot.sendMessage(chatId, '¿Cómo se llama la receta?');
            telegramBot.once('message', async (msg) => {
              const nombre = msg.text.trim();
              await telegramBot.sendMessage(chatId, '¿Cuáles son los ingredientes? (Separados por comas)');
              telegramBot.once('message', async (msg) => {
                const ingredientes = msg.text.split(',').map(i => i.trim());
                await telegramBot.sendMessage(chatId, 'Escribe las instrucciones:');
                telegramBot.once('message', async (msg) => {
                  const instrucciones = msg.text.trim();
                  const newReceta = new Receta({ nombre, ingredientes, instrucciones });
  
                  try {
                    await newReceta.save();
                    await telegramBot.sendMessage(chatId, `Receta "${nombre}" guardada correctamente.`);
                  } catch (error) {
                    console.error('Error al guardar receta:', error);
                    await telegramBot.sendMessage(chatId, 'Error al guardar la receta.');
                  }
                });
              });
            });
          break;

        case 'Preguntar sobre Cocina':
          await telegramBot.sendMessage(chatId, 'Escribe tu pregunta sobre cocina:');
          telegramBot.once('message', async (msg) => {
            const userQuestion = msg.text.trim();
            const response = await generateResponse(userQuestion);

            await telegramBot.sendMessage(chatId, response);

            const newPreguntaFrecuente = new PreguntaFrecuente({
              pregunta: userQuestion,
              respuesta: response,
            });

            try {
              await newPreguntaFrecuente.save();
            } catch (error) {
              console.error('Error al guardar pregunta frecuente:', error);
            }

            sendFeedback(chatId);
          });
          break;

        default:
          await telegramBot.sendMessage(chatId, 'No entiendo ese comando. Por favor, selecciona una opción del menú.');
          break;
      }
    }

    if (callback_query) {
      const { data, message } = callback_query;
      const chatId = message.chat?.id;

      if (data.startsWith('add_fav_')) {
        const recetaId = data.split('_')[2];
        const user = await Usuario.findOne({ userId: callback_query.from.id });
        if (user) {
          user.favoritos.push(recetaId);
          await user.save();
          await telegramBot.answerCallbackQuery(callback_query.id, 'Receta añadida a favoritos.');
        }
      }
    }

    return res.status(200).send('OK');
  }

  return res.status(405).send('Method Not Allowed');
}

async function setWebhook() {
  const webhookUrl = `${process.env.VERCEL_URL}/api/bot`;
  try {
    await telegramBot.setWebHook(webhookUrl);
    console.log('Webhook configurado correctamente:', webhookUrl);
  } catch (error) {
    console.error('Error al configurar el webhook:', error);
  }
}

setWebhook();