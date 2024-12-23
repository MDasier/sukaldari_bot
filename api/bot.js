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
          // Responder con las opciones del menú
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
          // Lógica para buscar recetas
          await telegramBot.sendMessage(chatId, 'Escribe el nombre, ingrediente o etiqueta para buscar recetas:');
          // Aquí esperamos la respuesta del usuario para buscar las recetas
            telegramBot.once('message', async (msg) => {
              const searchTerm = msg.text.trim().toLowerCase();

              // Buscar recetas en la base de datos
              const recetas = await Receta.find({
                $or: [
                  { nombre: { $regex: searchTerm, $options: 'i' } },
                  { ingredientes: { $regex: searchTerm, $options: 'i' } },
                  { etiquetas: { $regex: searchTerm, $options: 'i' } },
                ]
              });

              // Verificar si se encontraron recetas
              if (recetas.length > 0) {
                for (const receta of recetas) {
                  // Verificar si la receta ya está en los favoritos del usuario
                  const user = await Usuario.findOne({ userId: chatId });
                  const isFavorite = user && user.favoritos.includes(receta._id);

                  // Crear los botones inline para agregar/eliminar de favoritos
                  const inlineButtons = [
                    [
                      {
                        text: isFavorite ? 'Eliminar de favoritos' : 'Añadir a favoritos',
                        callback_data: isFavorite ? `remove_fav_${receta._id}` : `add_fav_${receta._id}`,
                      }
                    ]
                  ];

                  // Enviar receta con los botones
                  await telegramBot.sendMessage(
                    chatId,
                    `*${receta.nombre}*\nIngredientes: ${receta.ingredientes.join(', ')}\nInstrucciones: ${receta.instrucciones}`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } }
                  );
                }
              } else {
                await telegramBot.sendMessage(chatId, `No se encontraron recetas para "${searchTerm}".`);
              }

              // Volver a mostrar el menú después de la búsqueda
              await telegramBot.sendMessage(chatId, '¿Te gustaría buscar otra receta?', {
                reply_markup: {
                  keyboard: [
                    [{ text: 'Sí, buscar otra receta' }],
                    [{ text: 'No, regresar al menú principal' }],
                  ],
                  resize_keyboard: true,
                  one_time_keyboard: true,
                },
              });
            });
            break;

            case 'ver todas las recetas':
              // Lógica para mostrar todas las recetas
              const allRecetas = await Receta.find();
              if (allRecetas.length > 0) {
                for (const receta of allRecetas) {
                  // Verificar si la receta ya está en los favoritos del usuario
                  const user = await Usuario.findOne({ userId: message.from.id });
                  const isFavorite = user && user.favoritos.includes(receta._id);
            
                  // Crear los botones inline para agregar/eliminar de favoritos
                  const inlineButtons = [
                    [
                      {
                        text: isFavorite ? 'Eliminar de favoritos' : 'Añadir a favoritos',
                        callback_data: isFavorite ? `remove_fav_${receta._id}` : `add_fav_${receta._id}`,
                      }
                    ]
                  ];
            
                  // Enviar receta con los botones
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
              // Lógica para ver recetas favoritas
              const user = await Usuario.findOne({ userId: message.from.id });
              if (user && user.favoritos.length > 0) {
                const favoriteRecetas = await Receta.find({ _id: { $in: user.favoritos } });
                for (const receta of favoriteRecetas) {
                  // Crear los botones inline para eliminar de favoritos
                  const inlineButtons = [
                    [
                      {
                        text: 'Eliminar de favoritos',
                        callback_data: `remove_fav_${receta._id}`,
                      }
                    ]
                  ];
            
                  // Enviar receta favorita con el botón de eliminar
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
          // Lógica para añadir una receta
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

          case 'preguntar sobre cocina':
            // Lógica para responder preguntas sobre cocina
            await telegramBot.sendMessage(chatId, 'Escribe tu pregunta sobre cocina:');
            
            // Escuchar la respuesta del usuario a la pregunta
            telegramBot.once('message', async (msg) => {
              const userQuestion = msg.text.trim();
              
              // Generar la respuesta usando el servicio de Cohere (o cualquier otro servicio que utilices)
              const response = await generateResponse(userQuestion);
          
              // Enviar la respuesta generada al usuario
              await telegramBot.sendMessage(chatId, response);
          
              // Guardar la pregunta frecuente en la base de datos (si es relevante)
              const newPreguntaFrecuente = new PreguntaFrecuente({
                pregunta: userQuestion,
                respuesta: response,
              });
          
              try {
                await newPreguntaFrecuente.save(); // Guardar la pregunta y la respuesta generada
              } catch (error) {
                console.error('Error al guardar pregunta frecuente:', error);
              }
          
              // Enviar el mensaje de feedback al usuario (si le fue útil la respuesta)
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

      if (data === 'feedback_yes') {
        await telegramBot.sendMessage(chatId, '¡Gracias por tu feedback positivo!');
      } else if (data === 'feedback_no') {
        await telegramBot.sendMessage(chatId, 'Lo sentimos, intentamos mejorar día a día.');
      }
    
      // Asegurarse de que el botón se haya desactivado después de hacer clic
      await telegramBot.answerCallbackQuery(callback_query.id);
      if (data.startsWith('add_fav_')) {
        const recetaId = data.split('_')[2];
        const user = await Usuario.findOne({ userId: callback_query.from.id });
    
        if (user) {
          // Añadir receta a favoritos
          user.favoritos.push(recetaId);
          await user.save();
          await telegramBot.sendMessage(chatId, 'Receta añadida a tus favoritos.');
          await telegramBot.answerCallbackQuery(callback_query.id);  // Asegura que el botón no se quede en espera
        }
      }
    
      if (data.startsWith('remove_fav_')) {
        const recetaId = data.split('_')[2];
        const user = await Usuario.findOne({ userId: callback_query.from.id });
    
        if (user) {
          // Eliminar receta de favoritos
          user.favoritos = user.favoritos.filter(fav => fav.toString() !== recetaId);
          await user.save();
          await telegramBot.sendMessage(chatId, 'Receta eliminada de tus favoritos.');
          await telegramBot.answerCallbackQuery(callback_query.id);  // Asegura que el botón no se quede en espera
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