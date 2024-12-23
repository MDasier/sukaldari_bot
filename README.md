Asistente de Cocina en Telegram

Este es un bot de Telegram diseñado para ayudarte con recetas de cocina, preguntas frecuentes sobre cocina, y gestionar tus recetas favoritas. Puedes agregar nuevas recetas, consultar recetas existentes, obtener respuestas a preguntas sobre cocina, y mucho más.
Características

    Buscar Recetas: El bot puede ayudarte a buscar recetas según ingredientes o nombres de recetas.
    Agregar Receta: Los administradores pueden agregar nuevas recetas al sistema.
    Preguntar sobre Cocina: Utiliza el modelo de Cohere AI para responder a tus preguntas sobre cocina.
    Ver Recetas Favoritas: Guarda tus recetas favoritas y consúltalas cuando lo desees.
    Ver Todas las Recetas: Consulta todas las recetas disponibles en el sistema.

Requisitos

    Node.js: Este proyecto utiliza Node.js. Asegúrate de tenerlo instalado en tu máquina.
    MongoDB: Necesitarás MongoDB para almacenar las recetas, usuarios, y preguntas frecuentes.
    Telegram API Key: Debes tener un bot de Telegram y obtener una API Key desde BotFather.
    Cohere API Key: El bot utiliza Cohere para generar respuestas a preguntas sobre cocina. Regístrate en Cohere para obtener una clave de API.

Instalación

    Clona el repositorio:

git clone <URL_DE_TU_REPOSITORIO>
cd <DIRECTORIO_DEL_PROYECTO>

Instala las dependencias:

npm install

Configura el archivo .env:

Crea un archivo .env en la raíz del proyecto y agrega las siguientes variables de entorno:

TELEGRAM_API_KEY=tu_telegram_api_key
MONGO_URI=tu_uri_de_mongodb
COHERE_API_KEY=tu_api_key_de_cohere
ADMIN_ID=tu_id_de_telegram (solo si eres administrador)

Ejecuta el proyecto:

    node <nombre_del_archivo>.js

    El bot comenzará a funcionar y estará listo para interactuar en Telegram.

Uso

Una vez que el bot está en funcionamiento, puedes interactuar con él de la siguiente manera:
Comandos Disponibles:

    Chef!: Este comando inicia el bot y muestra el menú principal con las siguientes opciones:
        Buscar Recetas: Busca recetas por nombre o ingrediente.
        Agregar Receta: Solo los administradores pueden agregar nuevas recetas.
        Preguntar sobre Cocina: Realiza preguntas sobre cocina y obtén respuestas generadas por Cohere AI.
        Ver Recetas Favoritas: Consulta tus recetas favoritas guardadas.
        Ver Todas las Recetas: Consulta todas las recetas disponibles.

Feedback

Después de cada respuesta generada por el bot, se solicitará al usuario feedback para mejorar la experiencia. Puedes responder "Sí" o "No" para indicar si la respuesta fue útil.
Estructura de la Base de Datos

El proyecto usa MongoDB y tiene tres colecciones principales:

    Recetas: Almacena las recetas con nombre, ingredientes e instrucciones.
    Usuarios: Almacena información de los usuarios, incluidos sus favoritos.
    Preguntas Frecuentes: Almacena las preguntas y respuestas generadas por Cohere, junto con la cantidad de veces que se ha hecho cada pregunta.

Contribuciones

Las contribuciones son bienvenidas. Si deseas contribuir a este proyecto, por favor abre un "pull request" o crea un "issue" para discutir las mejoras.