import axios from 'axios'

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'

interface OllamaResponse {
  response: string
  done: boolean
}

export async function extractTagsFromDescription(
  title: string,
  description: string
): Promise<string[]> {
  const prompt = `Analyze this YouTube video about music/audio and extract relevant tags for categorization.

Title: ${title}

Description: ${description.slice(0, 1500)}

Extract 3-8 tags from these categories:
- Genre (e.g., jazz, hip-hop, electronic, classical, rock, soul, funk)
- Mood (e.g., chill, energetic, dark, uplifting, melancholic)
- Instruments (e.g., piano, drums, guitar, synth, bass, strings)
- Era/decade (e.g., 70s, 80s, vintage, modern)
- Style (e.g., lo-fi, cinematic, ambient, acoustic)
- Use case (e.g., sampling, beats, loops, vocals)

Return ONLY a JSON array of lowercase tag strings, nothing else.
Example: ["jazz", "piano", "70s", "chill", "sampling"]`

  try {
    const response = await axios.post<OllamaResponse>(
      `${OLLAMA_HOST}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 200,
        },
      },
      {
        timeout: 60000, // 60 second timeout
      }
    )

    const text = response.data.response.trim()

    // Try to extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      const tags = JSON.parse(jsonMatch[0])
      if (Array.isArray(tags)) {
        return tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.toLowerCase().trim())
          .filter((t) => t.length > 0 && t.length < 30)
          .slice(0, 8)
      }
    }

    // Fallback: try to extract comma-separated tags
    const commaTags = text
      .replace(/[\[\]"']/g, '')
      .split(',')
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0 && t.length < 30)
      .slice(0, 8)

    return commaTags.length > 0 ? commaTags : []
  } catch (error) {
    console.error('Ollama tag extraction failed:', error)
    return []
  }
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`, {
      timeout: 5000,
    })
    return response.status === 200
  } catch {
    return false
  }
}

export async function ensureModelAvailable(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`)
    const models = response.data.models || []
    return models.some((m: any) => m.name.startsWith(OLLAMA_MODEL.split(':')[0]))
  } catch {
    return false
  }
}
