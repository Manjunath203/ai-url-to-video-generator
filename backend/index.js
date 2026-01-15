import express from 'express';
import uniqid from 'uniqid';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/stories', express.static('stories'));

// API Keys from environment
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// API endpoints
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const HF_WHISPER_API = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const ELEVENLABS_TTS_API = 'https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL';

// ============================================
// STEP 1: Extract and Summarize (Perplexity)
// ============================================
async function extractAndSummarize(url) {
  try {
    console.log('[Perplexity] Extracting content...');
    const response = await axios.post(
      PERPLEXITY_API_URL,
      {
        model: 'sonar-pro',
        messages: [
          {
            role: 'user',
            content: `Extract and summarize the main content from this URL in exactly 100 words, no emojis: ${url}`
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('[Perplexity] Error:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// STEP 2: Generate Images (Pollinations.ai)
// ============================================
async function generateImage(text, dir, index) {
  try {
    console.log(`[Image Generation] Creating image ${index}...`);
    
    const prompt = encodeURIComponent(`Cinematic, photorealistic scene: ${text.substring(0, 80)}`);
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1280&height=720&nologo=true`;
    
    console.log(`[Image Generation] Prompt: ${text.substring(0, 50)}...`);
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 90000
    });
    
    const imagePath = path.join(dir, `b-roll-${index}.png`);
    fs.writeFileSync(imagePath, response.data);
    
    console.log(`[Image Generation] ✅ Saved real image to ${imagePath}`);
    return imagePath;
  } catch (error) {
    console.error('[Image Generation] Error:', error.message);
    
    const imagePath = path.join(dir, `b-roll-${index}.png`);
    const placeholderData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(imagePath, placeholderData);
    console.log(`[Image Generation] ⚠️  Using placeholder`);
    return imagePath;
  }
}

// ============================================
// STEP 3: Text-to-Speech (ElevenLabs)
// ============================================
async function generateVoiceover(text, dir, index) {
  try {
    console.log(`[TTS] Generating voiceover for part ${index}...`);
    
    const response = await axios.post(
      ELEVENLABS_TTS_API,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      },
      {
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    const audioPath = path.join(dir, `voiceover-${index}.mp3`);
    fs.writeFileSync(audioPath, response.data);
    
    console.log(`[TTS] ✅ Saved real voiceover to ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error('[TTS] Error:', error.response?.data || error.message);
    console.log(`[TTS] ⚠️  Creating text placeholder for part ${index}...`);
    
    const placeholderPath = path.join(dir, `voiceover-${index}.txt`);
    fs.writeFileSync(placeholderPath, `Voiceover text for part ${index}:\n\n${text}`);
    
    console.log(`[TTS] ✅ Saved text placeholder`);
    return null;
  }
}

// ============================================
// STEP 4: Speech-to-Text (Skipped for now)
// ============================================
async function transcribeAudio(audioPath, dir, index) {
  console.log(`[STT] ⏭️  Skipping transcription for part ${index} (server issues)`);
  return null;
}

// ============================================
// STEP 5: Generate Subtitle Files (.srt)
// ============================================
function generateSubtitles(text, dir, index) {
  try {
    console.log(`[Subtitles] Creating subtitle file ${index}...`);
    
    // Calculate duration based on text length (rough estimate: 150 words per minute)
    const words = text.split(' ').length;
    const duration = Math.ceil((words / 150) * 60); // seconds
    
    const srtContent = `1
00:00:00,000 --> 00:00:${duration.toString().padStart(2, '0')},000
${text}
`;
    
    const srtPath = path.join(dir, `subtitle-${index}.srt`);
    fs.writeFileSync(srtPath, srtContent);
    
    console.log(`[Subtitles] ✅ Saved subtitle to ${srtPath}`);
    return srtPath;
  } catch (error) {
    console.error('[Subtitles] Error:', error.message);
    return null;
  }
}

// ============================================
// STEP 6: Generate Final Video with Subtitles
// ============================================
async function generateVideo(dir, storyId) {
  return new Promise((resolve, reject) => {
    console.log('[Video] Starting video generation with subtitles...');
    
    const outputPath = path.join(dir, `final-video.mp4`);
    
    // Create a concat file list for ffmpeg
    const concatFilePath = path.join(dir, 'concat-list.txt');
    const concatContent = `file 'b-roll-1.png'
duration 10
file 'b-roll-2.png'
duration 10
file 'b-roll-3.png'
duration 10
`;
    fs.writeFileSync(concatFilePath, concatContent);
    
    // Combine all subtitle files into one with adjusted timestamps
    const combinedSrtPath = path.join(dir, 'combined-subtitles.srt');
    const srt1 = fs.readFileSync(path.join(dir, 'subtitle-1.srt'), 'utf8');
    const srt2 = fs.readFileSync(path.join(dir, 'subtitle-2.srt'), 'utf8');
    const srt3 = fs.readFileSync(path.join(dir, 'subtitle-3.srt'), 'utf8');
    
    // Adjust timestamps for parts 2 and 3
    const adjustedSrt2 = srt2.replace(/00:00:(\d{2}),(\d{3})/g, (match, sec, ms) => {
      const newSec = parseInt(sec) + 10;
      return `00:00:${newSec.toString().padStart(2, '0')},${ms}`;
    }).replace(/^1$/m, '2');
    
    const adjustedSrt3 = srt3.replace(/00:00:(\d{2}),(\d{3})/g, (match, sec, ms) => {
      const newSec = parseInt(sec) + 20;
      return `00:00:${newSec.toString().padStart(2, '0')},${ms}`;
    }).replace(/^1$/m, '3');
    
    const combinedSrt = srt1 + '\n' + adjustedSrt2 + '\n' + adjustedSrt3;
    fs.writeFileSync(combinedSrtPath, combinedSrt);
    
    console.log('[Video] Subtitle file created:', combinedSrtPath);
    
    // Generate video with burned-in subtitles
    const subtitlePath = combinedSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    
    ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .input(path.join(dir, 'voiceover-1.mp3'))
      .input(path.join(dir, 'voiceover-2.mp3'))
      .input(path.join(dir, 'voiceover-3.mp3'))
      .complexFilter([
        '[1:a][2:a][3:a]concat=n=3:v=0:a=1[outa]',
        `[0:v]subtitles='${subtitlePath}':force_style='Fontsize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'[outv]`
      ])
      .outputOptions([
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        '-shortest'
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('[Video] ffmpeg command:', cmd);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[Video] Processing: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('[Video] ✅ Video with subtitles complete!');
        // Clean up
        try {
          fs.unlinkSync(concatFilePath);
          fs.unlinkSync(combinedSrtPath);
        } catch (e) {
          console.log('[Video] Cleanup warning:', e.message);
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('[Video] Error:', err.message);
        reject(err);
      })
      .run();
  });
}

// ============================================
// MAIN API ENDPOINT
// ============================================
app.get('/create-story', async (req, res) => {
  const url = decodeURIComponent(req.query.url);
  const storyId = uniqid();
  const storyDir = path.join('stories', storyId);
  fs.mkdirSync(storyDir, { recursive: true });

  console.log(`\n[Create-Story] Processing URL: ${url}`);
  console.log(`[Create-Story] Output directory: ${storyDir}\n`);

  try {
    // Extract and summarize
    const summary = await extractAndSummarize(url);
    console.log(`[Create-Story] Summary created: ${summary.substring(0, 100)}...\n`);

    // Split into 3 parts
    const words = summary.split(' ');
    const chunkSize = Math.ceil(words.length / 3);
    const parts = [
      words.slice(0, chunkSize).join(' '),
      words.slice(chunkSize, chunkSize * 2).join(' '),
      words.slice(chunkSize * 2).join(' ')
    ];

    // Save text files
    for (let i = 0; i < parts.length; i++) {
      fs.writeFileSync(path.join(storyDir, `story-${i + 1}.txt`), parts[i]);
      console.log(`[Create-Story] ✅ Saved story-${i + 1}.txt`);
    }
    console.log('');

    // Generate assets for each part
    for (let i = 0; i < parts.length; i++) {
      console.log(`[Create-Story] Processing part ${i + 1}/3...`);
      
      await generateImage(parts[i], storyDir, i + 1);
      const audioPath = await generateVoiceover(parts[i], storyDir, i + 1);
      
      // Generate subtitles
      generateSubtitles(parts[i], storyDir, i + 1);
      
      console.log('');
    }

    // Generate final video
    console.log('[Create-Story] Generating final video...\n');
    const videoPath = await generateVideo(storyDir, storyId);
    
    console.log(`[Create-Story] ✅ Story generation complete!\n`);

    res.json({ 
      id: storyId, 
      message: 'Story video generated successfully!',
      summary: summary.substring(0, 100) + '...',
      videoUrl: `http://localhost:8080/stories/${storyId}/final-video.mp4`,
      files: {
        text: ['story-1.txt', 'story-2.txt', 'story-3.txt'],
        images: ['b-roll-1.png', 'b-roll-2.png', 'b-roll-3.png'],
        audio: ['voiceover-1.mp3', 'voiceover-2.mp3', 'voiceover-3.mp3'],
        subtitles: ['subtitle-1.srt', 'subtitle-2.srt', 'subtitle-3.srt'],
        video: 'final-video.mp4'
      }
    });
  } catch (error) {
    console.error('[Create-Story] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(8080, () => {
  console.log('🚀 Server running on port 8080');
  console.log('📝 Test with: curl "http://localhost:8080/create-story?url=YOUR_URL"\n');
});
