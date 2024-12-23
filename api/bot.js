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

const userState = {}; 

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
    if (!message) return res.status(400).send('Bad Request');

    const chatId = message.chat?.id;
    const messageText = message.text?.trim().toLowerCase();

    if (!chatId) return res.status(400).send('Bad Request');
      // Manejo de callback_query
      if (callback_query) {
        const { data, message } = callback_query;
        const chatId = message.chat?.id;

      if (data === 'feedback_yes') {
        await telegramBot.sendMessage(chatId, '¡Gracias por tu feedback positivo!');
      } else if (data === 'feedback_no') {
        await telegramBot.sendMessage(chatId, 'Lo sentimos, intentamos mejorar día a día.');
      }

      // Responder al callback query
      await telegramBot.answerCallbackQuery(callback_query.id);

        // Manejo de favoritos (añadir o eliminar)
        if (data.startsWith('add_fav_')) {
          const recetaId = data.split('_')[2];
          const user = await Usuario.findOne({ userId: callback_query.from.id });

          if (user) {
            if (!user.favoritos.includes(recetaId)) {
              user.favoritos.push(recetaId);
              await user.save();
              await telegramBot.sendMessage(chatId, 'Receta añadida a tus favoritos.');
            } else {
              await telegramBot.sendMessage(chatId, 'Esta receta ya está en tus favoritos.');
            }
          }
        }

        if (data.startsWith('remove_fav_')) {
          const recetaId = data.split('_')[2];
          const user = await Usuario.findOne({ userId: callback_query.from.id });

          if (user) {
            user.favoritos = user.favoritos.filter(fav => fav.toString() !== recetaId);
            await user.save();
            await telegramBot.sendMessage(chatId, 'Receta eliminada de tus favoritos.');
          }
        }
        
        return res.status(200).send('OK');
      }
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

      case 'buscar recetas':
        userState[chatId] = 'buscando_receta';
        await telegramBot.sendMessage(chatId, 'Escribe el nombre, ingrediente o etiqueta para buscar recetas:');
        break;

      case 'ver todas las recetas':
        const allRecetas = await Receta.find();
        if (allRecetas.length > 0) {
          for (const receta of allRecetas) {
            const user = await Usuario.findOne({ userId: chatId });
            const isFavorite = user && user.favoritos.includes(receta._id);
            const inlineButtons = [
              [
                {
                  text: isFavorite ? 'Eliminar de favoritos' : 'Añadir a favoritos',
                  callback_data: isFavorite ? `remove_fav_${receta._id}` : `add_fav_${receta._id}`,
                }
              ]
            ];
            await telegramBot.sendMessage(
              chatId,
              `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } }
            );
          }
        } else {
          await telegramBot.sendMessage(chatId, 'No hay recetas disponibles.');
        }
        break;

      case 'ver recetas favoritas':
        const user = await Usuario.findOne({ userId: chatId });
        if (user && user.favoritos.length > 0) {
          const favoriteRecetas = await Receta.find({ _id: { $in: user.favoritos } });
          for (const receta of favoriteRecetas) {
            const inlineButtons = [
              [
                {
                  text: 'Eliminar de favoritos',
                  callback_data: `remove_fav_${receta._id}`,
                }
              ]
            ];
            await telegramBot.sendMessage(
              chatId,
              `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } }
            );
          }
        } else {
          await telegramBot.sendMessage(chatId, 'No tienes recetas favoritas guardadas.');
        }
        break;

      case 'añadir receta':
        if (!isAdmin(message)) {
          await telegramBot.sendMessage(chatId, 'No tienes permisos para agregar recetas.');
          return;
        }
        userState[chatId] = 'añadiendo_receta';
        await telegramBot.sendMessage(chatId, '¿Cómo se llama la receta?');
        break;

      case 'preguntar sobre cocina':
        userState[chatId] = 'preguntando';
        await telegramBot.sendMessage(chatId, 'Escribe tu pregunta sobre cocina:');
        break;

      default:
        if (userState[chatId] === 'buscando_receta') {
          const searchTerm = messageText;
    
          if (!searchTerm || searchTerm.trim().length === 0) {
            await telegramBot.sendMessage(chatId, 'Por favor, escribe un término válido de búsqueda.');
            return; 
          }
    
          const recetas = await Receta.find({
            $or: [
              { nombre: { $regex: searchTerm, $options: 'i' } },
              { ingredientes: { $regex: searchTerm, $options: 'i' } },
              { etiquetas: { $regex: searchTerm, $options: 'i' } },
            ]
          });
    
          if (recetas.length > 0) {
            for (const receta of recetas) {
              const user = await Usuario.findOne({ userId: chatId });
              const isFavorite = user && user.favoritos.includes(receta._id);
              const inlineButtons = [
                [
                  {
                    text: isFavorite ? 'Eliminar de favoritos' : 'Añadir a favoritos',
                    callback_data: isFavorite ? `remove_fav_${receta._id}` : `add_fav_${receta._id}`,
                  }
                ]
              ];
              await telegramBot.sendMessage(
                chatId,
                `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } }
              );
            }
          } else {
            await telegramBot.sendMessage(chatId, `No se encontraron recetas para "${searchTerm}".`);
          }      
          userState[chatId] = null;
        }else if (userState[chatId] === 'preguntando') {
          const userQuestion = message.text.trim();
          if (userQuestion) {
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
            userState[chatId] = null;
          }
        }else if (userState[chatId] === 'añadiendo_receta') {
          const nombre = message.text.trim();
          userState[chatId] = 'esperando_ingredientes';
          await telegramBot.sendMessage(chatId, '¿Cuáles son los ingredientes? (Separados por comas)');
        }else if (userState[chatId] === 'esperando_ingredientes') {
          const ingredientes = message.text.split(',').map(i => i.trim());
          userState[chatId] = 'esperando_instrucciones';
          await telegramBot.sendMessage(chatId, 'Escribe las instrucciones de la receta.');
        }else if (userState[chatId] === 'esperando_instrucciones') {
          const instrucciones = message.text.trim();
          const newReceta = new Receta({ nombre: userState[chatId], ingredientes, instrucciones });
    
          try {
            await newReceta.save();
            await telegramBot.sendMessage(chatId, `Receta "${userState[chatId]}" guardada correctamente.`);
            userState[chatId] = null;
          } catch (error) {
            console.error('Error al guardar receta:', error);
            await telegramBot.sendMessage(chatId, 'Error al guardar la receta.');
          }
        }else {
          await telegramBot.sendMessage(chatId, 'No entiendo ese comando. Por favor, selecciona una opción del menú.');
        }
        break;
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