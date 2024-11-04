const express = require("express");
const { google } = require("googleapis");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));

app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const { auth } = require('express-openid-connect');

const config = {
  authRequired: true,
  auth0Logout: true,
  secret: 'a long, randomly-generated string stored in env',
  baseURL: process.env.BASE_URL,
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: process.env.ISSUER_BASE_URL,
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

// req.isAuthenticated is provided from the auth router
app.get('/login', (req, res) => {
    if (req.oidc.isAuthenticated()) {
       res.redirect('/');
     } else {
        res.render('login'); // Renderiza la vista login.ejs cuando el usuario no está autenticado
    }
});

app.get('/logout', (req, res) => {
    req.oidc.logout(); // Llama al método de logout de Auth0 para cerrar la sesión
});

async function addSheetAndInsertData(spreadsheetId, sheetTitle, data) {
    const auth = new google.auth.GoogleAuth({
        credentials: getCredentials(),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // Paso 1: Crear una nueva hoja
    const addSheetRequest = {
        spreadsheetId: spreadsheetId,
        resource: {
            requests: [{
                addSheet: {
                    properties: {
                        title: sheetTitle,
                    }
                }
            }]
        }
    };

    // Ejecutar la solicitud de agregar hoja
    const addSheetResponse = await sheets.spreadsheets.batchUpdate(addSheetRequest);
    const newSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;

    // Paso 2: Insertar los datos en la nueva hoja
    const updateRequest = {
        spreadsheetId: spreadsheetId,
        range: `${sheetTitle}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: data // Ajusta esto según el formato que necesites
        }
    };

    await sheets.spreadsheets.values.update(updateRequest);
}

// Actualiza la ruta /generate
app.post("/generate", async (req, res) => {
    const { prompt, spreadsheetId } = req.body; // Asegúrate de que también recibes el ID del spreadsheet

    console.log(prompt)

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-002" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log(response.text())
        
        const text = JSON.parse(response.text());
        
        // Crear una nueva hoja y agregar el texto generado
        const newSheetTitle = `Generado ${new Date().toISOString()}`;
        await addSheetAndInsertData(spreadsheetId, newSheetTitle, text); // Pasar el ID y el título de la hoja

        res.json({ text }); // Devuelve el texto generado
    } catch (error) {
        console.error("Error al generar contenido:", error);
        res.status(500).json({ error: "Error al generar contenido" });
    }
});

// Función para obtener datos de Google Sheets
async function getSheetData(spreadsheetId, range) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });

  const getRows = await googleSheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: range,
  });

  return getRows.data.values || [];
}

// Nueva función para obtener nombres de las hojas
async function getSheetNames(spreadsheetId) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });

  const response = await googleSheets.spreadsheets.get({
    auth,
    spreadsheetId,
  });

  const sheets = response.data.sheets;
  return sheets.map(sheet => sheet.properties.title); // Devuelve solo los nombres de las hojas
}

// Función para obtener credenciales de Google Sheets
function getCredentials() {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
}

// Ruta GET para mostrar la página con los datos actuales
app.get("/", async (req, res) => {

    if (req.oidc.isAuthenticated()){
        const sheetNames = []; // Inicialmente vacío
        res.render("index", { sheetNames, fileName: '', sheetData: [] }); // Pasar nombres de hojas vacíos y otros vacíos
    } else {
        res.redirect('/login');
    }
});

// Nueva ruta para cargar datos de Google Sheets
app.get("/cargar-sheet", async (req, res) => {
    const spreadsheetId = req.query.spreadsheetId;
    let range = req.query.range; // Obtener el rango de la consulta
    try {
        // Obtener los nombres de las hojas
        const sheetNames = await getSheetNames(spreadsheetId);

        // Si el rango no se proporciona, seleccionar el primero de sheetNames
        if (!range && sheetNames.length > 0) {
            range = sheetNames[0]; // Seleccionar el primer nombre de hoja
        }

        // Obtener datos de la hoja
        const sheetData = await getSheetData(spreadsheetId, range);

        // Obtener el nombre del archivo
        const auth = new google.auth.GoogleAuth({
            credentials: getCredentials(),
            scopes: "https://www.googleapis.com/auth/spreadsheets",
        });

        const client = await auth.getClient();
        const googleSheets = google.sheets({ version: "v4", auth: client });

        const response = await googleSheets.spreadsheets.get({
            auth,
            spreadsheetId,
        });

        const fileName = response.data.properties.title; // Obtener el nombre del archivo

        res.json({ sheetData, fileName, sheetNames }); // Retornar datos de la hoja, el nombre del archivo y los nombres de las hojas
    } catch (error) {
        console.error('Error al cargar la hoja de cálculo:', error);
        res.status(500).send('Error al cargar los datos');
    }
});


// Función para autorizar y agregar nueva hoja al enviar el formulario
app.post('/submit', async (req, res) => {
    const spreadsheetId = req.body.spreadsheetId;
    const formData = [
        ["Columna 1", "Columna 2", "Columna 3"], // Encabezados
        [req.body.request, req.body.name, "Valor 3"] // Datos obtenidos del formulario
    ];

    const newSheetTitle = 'Nueva Hoja de Envío ' + new Date().toISOString();

    try {
        // Configuración de autenticación
        const auth = new google.auth.GoogleAuth({
            credentials: getCredentials(),
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
        
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        // Paso 1: Crear una nueva hoja
        const addSheetRequest = {
            spreadsheetId: spreadsheetId,
            resource: {
                requests: [{
                    addSheet: {
                        properties: {
                            title: newSheetTitle,
                        }
                    }
                }]
            }
        };

        // Ejecutar la solicitud de agregar hoja
        const addSheetResponse = await sheets.spreadsheets.batchUpdate(addSheetRequest);
        const newSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;

        // Paso 2: Insertar los datos en la nueva hoja
        const updateRequest = {
            spreadsheetId: spreadsheetId,
            range: `${newSheetTitle}!A1`,
            valueInputOption: 'RAW',
            resource: {
                values: formData
            }
        };

        await sheets.spreadsheets.values.update(updateRequest);

        // Enviar respuesta al cliente
        res.send("Datos insertados en la nueva hoja correctamente.");
    } catch (error) {
        console.error("Error al crear o escribir en la hoja:", error);
        res.status(500).send("Error al procesar la solicitud.");
    }
});

// Ruta POST para añadir nuevos datos y recargar la página con los datos actualizados
app.post("/", async (req, res) => {
  const { request, name, spreadsheetId, range } = req.body;

  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });

  await googleSheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
    range: range,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[request, name]],
    },
  });

  const sheetData = await getSheetData(spreadsheetId, range);
  console.log(sheetData)

  res.render("index", { sheetData: sheetData, sheetNames: await getSheetNames(spreadsheetId) }); // Actualizar la vista
});

app.listen(1337, () => console.log("corriendo en 1337"));
