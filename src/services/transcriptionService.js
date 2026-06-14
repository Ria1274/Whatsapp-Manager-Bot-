const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');

let openaiInstance = null;

function getOpenAIClient() {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY is not configured in environment.');
    }
    const config = { apiKey };
    if (process.env.OPENAI_BASE_URL) {
      config.baseURL = process.env.OPENAI_BASE_URL;
    }
    openaiInstance = new OpenAI(config);
  }
  return openaiInstance;
}

/**
 * Downloads a media file from Twilio and uses OpenAI Whisper to transcribe it.
 * 
 * @param {string} fileUrl - The public URL of the audio file
 * @returns {Promise<string>} The transcription text
 */
async function transcribeAudio(fileUrl) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Generate a temporary file path
  const tempFilePath = path.join(tempDir, `twilio_voice_${Date.now()}.ogg`);

  console.log(`[transcribeAudio] Downloading audio from Twilio: ${fileUrl}`);

  // 1. Download the file as a stream
  const response = await axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(tempFilePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  console.log(`[transcribeAudio] Audio downloaded to temporary file: ${tempFilePath}`);

  // 2. Transcribe using OpenAI Whisper API
  try {
    const openai = getOpenAIClient();
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1'
    });

    console.log(`[transcribeAudio] Whisper successfully transcribed audio: "${transcription.text}"`);

    // Clean up temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return transcription.text;
  } catch (error) {
    console.error(`[transcribeAudio] Transcription failed: ${error.message}`);
    // Ensure the temp file is deleted on failure
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw error;
  }
}

module.exports = {
  transcribeAudio
};
