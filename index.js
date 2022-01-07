const express = require("express");
const { Client } = require('pg');
const cors = require('cors');

const env = process.env;
const client = new Client({
  host: env.DB_HOST || 'localhost',
  port: env.DB_PORT || '5432',
  database: env.DB_NAME || 'ava',
  user: env.DB_USER || '',
  password: env.DB_PASSWORD || '',
});


(async () => {

  await client.connect();
  
  const app = express();
  const port = process.env.PORT || 3000;
  
  app.listen(port, 
      () => console.log(`Server Start at the Port ${port}`));
     
  app.use(express.json());
  app.use(cors());
  
  const BASE_PATH = '/dev';
  app.get(BASE_PATH, ping);
  app.get(BASE_PATH + '/ping', ping);
  app.get(BASE_PATH + '/info', info);
  app.get(BASE_PATH + '/conversations', conversations);
  app.post(BASE_PATH + '/mutations', mutations);
    
})().catch(e => console.error(e.stack))


function ping(request, response) {
  //console.info(`ping - request: `, request);
  response.json({
    "ok": true,
    "msg": "pong"
  });
}

function info(request, response) {
  //console.info(`info - request: ${request}`);
  response.json({
    "ok": true,
    "author": {
      "email": "hiroshitash@hotmail.com",
      "name": "Hiroshi Tashiro"
    },
    "frontend": {
      "url": "string, the url of your frontend."
    },
    "language": "node.js",
    "sources": "https://github.com/hiroshitash"
  });
}

async function conversations(request, response) {
  //console.info(`conversations - request: `, request);
  try {
    const query = `SELECT id, text, lastmutation AS lastMutation FROM conversation ORDER BY id ASC`;
    const result = await client.query(query);

    response.json({
      "ok": true,
      "conversations": result.rows.map(eachRow => {return {...eachRow, 'lastMutation': eachRow.lastmutation}})
    });
  } catch (err) {
    console.error(err);
    return response.status(400)
    .json({
      "ok": false,
      "text": "unknown error"
    });
  }
}

async function mutations(request, response) {
  //console.info(`mutation - request: `, request);
  try {
    const body = request.body;

    const invalidMsg = validateMutation(body);
    if (invalidMsg) {
      return response.status(400)
      .json({
        "ok": false,
        //"text": invalidMsg
      });
    }

    await client.query('BEGIN');
    const selectQuery = {
      text: `SELECT * FROM conversation WHERE id = $1 FOR UPDATE`,
      values: [body.conversationId]
    }
    let conversationResult = await client.query(selectQuery);
    let text;

    const queryType = conversationResult.rows.length === 0 ? 'insert' : 'update';
    switch (queryType) {
      case 'insert':
        text = body.data.text;
        const insertQuery = {
          text: 'INSERT INTO conversation(id, text, lastMutation) VALUES($1, $2, $3)',
          values: [
            body.conversationId, text, 
            {...body.data, 'author': body.author, 'origin': body.origin}
          ],
        };
        conversationResult = await client.query(insertQuery);
        break;

      case 'update':
        let currentConversation = conversationResult.rows[0];
        text = currentConversation.text;

        const lastMutation = currentConversation.lastMutation;

        if (body.data.type === 'insert') {
          text = text.substring(0, body.data.index) + body.data.text + text.substring(body.data.index);
        } else if (body.data.type === 'delete') {
          text = text.substring(0, body.data.index) + text.substring(body.data.index + body.data.length);
        }

        const updateQuery = {
          text: 'UPDATE conversation SET text = $2, lastMutation = $3 WHERE id = $1',
          values: [
            body.conversationId, text, 
            {...body.data, 'author': body.author, 'origin': body.origin}
          ],
        };
        conversationResult = await client.query(updateQuery);
        break;

      default:
        throw `Unknown data.type ${body.data.type}`;
    }
    
    await client.query('COMMIT');
    response.status(201).json({
      "ok": true,
      "text": text
    });
  } catch (err) {
    await client.query('ROLLBACK');

    console.error(err);
    return response.status(400)
    .json({
      "ok": false,
      "text": err.message
    });
  }
}

function validateMutation(mutation) {
  if (!mutation.conversationId) {
    return 'Missing conversationId';
  }

  if (!mutation.data) {
    return 'Missing data';
  }
  return null;
}

