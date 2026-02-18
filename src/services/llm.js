/**
 * OpenAI GPT - Réponses en streaming pour conversation vocale
 * Doc: https://platform.openai.com/docs/api-reference/chat/create
 */

const OpenAI = require('openai');
const config = require('../config');

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

/**
 * Envoie les messages à GPT et stream la réponse token par token.
 * @param {Array<{role: string, content: string}>} messages - Historique + dernier message
 * @param {Object} callbacks
 * @param {function(string)} callbacks.onChunk - Texte reçu (delta)
 * @param {function(string)} callbacks.onDone - Réponse complète
 * @param {function(Error)} callbacks.onError
 * @returns {Promise<void>}
 */
async function streamChatCompletion(messages, callbacks) {
  const client = getClient();
  const systemMessage = { role: 'system', content: config.openai.systemPrompt };
  const allMessages = [systemMessage, ...messages];

  try {
    const stream = await client.chat.completions.create({
      model: config.openai.model,
      messages: allMessages,
      stream: true,
      max_tokens: 150,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        callbacks.onChunk?.(delta);
      }
    }
    callbacks.onDone?.(fullContent);
  } catch (err) {
    callbacks.onError?.(err);
  }
}

module.exports = { streamChatCompletion, getClient };
