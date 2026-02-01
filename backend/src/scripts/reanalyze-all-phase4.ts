#!/usr/bin/env tsx
/**
 * Batch Re-Analysis Script for Phase 4
 *
 * This script re-analyzes all existing audio slices with Phase 4 features:
 * - ML-based instrument classification (YAMNet)
 * - Genre/mood classification (Essentia MusicExtractor)
 * - 1024-dim embeddings for similarity matching
 *
 * Usage:
 *   npx tsx src/scripts/reanalyze-all-phase4.ts [--level advanced] [--limit N]
 *
 * Options:
 *   --level <quick|standard|advanced>  Analysis level (default: advanced)
 *   --limit <N>                        Only re-analyze first N slices (for testing)
 *   --skip-existing                    Skip slices that already have Phase 4 features
 */

import { db, schema } from '../db/index.js'
import { analyzeAudioFeatures, storeAudioFeatures } from '../services/audioAnalysis.js'
import type { AnalysisLevel } from '../services/audioAnalysis.js'
import { eq } from 'drizzle-orm'

interface Options {
  level: AnalysisLevel
  limit?: number
  skipExisting: boolean
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const options: Options = {
    level: 'advanced',
    skipExisting: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--level':
        options.level = args[++i] as AnalysisLevel
        break
      case '--limit':
        options.limit = parseInt(args[++i])
        break
      case '--skip-existing':
        options.skipExisting = true
        break
      case '--help':
        console.log(`
Batch Re-Analysis Script for Phase 4

Usage:
  npx tsx src/scripts/reanalyze-all-phase4.ts [options]

Options:
  --level <quick|standard|advanced>  Analysis level (default: advanced)
  --limit <N>                        Only re-analyze first N slices
  --skip-existing                    Skip slices that already have Phase 4 features
  --help                             Show this help message
        `)
        process.exit(0)
    }
  }

  return options
}

async function reanalyzeAll(options: Options) {
  console.log('🔍 Phase 4 Batch Re-Analysis')
  console.log('═'.repeat(60))
  console.log(`Analysis level: ${options.level}`)
  console.log(`Skip existing: ${options.skipExisting}`)
  if (options.limit) {
    console.log(`Limit: ${options.limit} slices`)
  }
  console.log('═'.repeat(60))
  console.log()

  // Fetch all slices with their file paths
  const allSlices = await db
    .select({
      id: schema.slices.id,
      name: schema.slices.name,
      filePath: schema.slices.filePath,
      trackId: schema.slices.trackId,
    })
    .from(schema.slices)
    .all()

  console.log(`Found ${allSlices.length} total slices`)

  // Filter slices with valid file paths
  const validSlices = allSlices.filter((s) => s.filePath)
  console.log(`${validSlices.length} slices have audio files`)
  console.log()

  // Apply limit if specified
  const slicesToProcess = options.limit
    ? validSlices.slice(0, options.limit)
    : validSlices

  console.log(`Processing ${slicesToProcess.length} slices...\n`)

  let processed = 0
  let skipped = 0
  let failed = 0
  const errors: Array<{ id: number; name: string; error: string }> = []

  for (const slice of slicesToProcess) {
    const progress = `[${processed + skipped + failed + 1}/${slicesToProcess.length}]`

    try {
      // Check if slice already has Phase 4 features
      if (options.skipExisting) {
        const existing = await db
          .select({
            yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
          })
          .from(schema.audioFeatures)
          .where(eq(schema.audioFeatures.sliceId, slice.id))
          .limit(1)

        if (existing.length > 0 && existing[0].yamnetEmbeddings) {
          console.log(`${progress} ⏭️  Skipped: "${slice.name}" (already has Phase 4 features)`)
          skipped++
          continue
        }
      }

      console.log(`${progress} 🎵 Analyzing: "${slice.name}"`)

      // Re-run analysis with specified level
      const features = await analyzeAudioFeatures(slice.filePath!, options.level)

      // Update database
      await storeAudioFeatures(slice.id, features)

      processed++

      // Show what was extracted
      const mlFeatures = []
      if (features.instrumentClasses && features.instrumentClasses.length > 0) {
        const topInstrument = features.instrumentClasses[0]
        mlFeatures.push(`🎸 ${topInstrument.class} (${(topInstrument.confidence * 100).toFixed(0)}%)`)
      }
      if (features.genrePrimary) {
        mlFeatures.push(`🎼 ${features.genrePrimary}`)
      }
      if (features.yamnetEmbeddings) {
        mlFeatures.push(`🧬 Embeddings: 1024-dim`)
      }

      if (mlFeatures.length > 0) {
        console.log(`${progress} ✅ Completed: ${mlFeatures.join(', ')}`)
      } else {
        console.log(`${progress} ✅ Completed (no ML features extracted)`)
      }

      // Rate limit to avoid overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error) {
      failed++
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push({ id: slice.id, name: slice.name, error: errorMsg })
      console.error(`${progress} ❌ Failed: "${slice.name}" - ${errorMsg}`)
    }

    console.log()
  }

  // Summary
  console.log('═'.repeat(60))
  console.log('📊 Summary')
  console.log('═'.repeat(60))
  console.log(`✅ Successfully processed: ${processed}`)
  if (skipped > 0) {
    console.log(`⏭️  Skipped (existing):    ${skipped}`)
  }
  console.log(`❌ Failed:               ${failed}`)
  console.log(`📝 Total:                ${processed + skipped + failed}`)
  console.log()

  if (errors.length > 0) {
    console.log('❌ Failed slices:')
    for (const err of errors) {
      console.log(`   - [${err.id}] ${err.name}: ${err.error}`)
    }
    console.log()
  }

  console.log('✨ Re-analysis complete!')

  if (failed > 0) {
    console.log('\n⚠️  Some slices failed. Common issues:')
    console.log('   - Missing TensorFlow: pip install tensorflow tensorflow-hub')
    console.log('   - Model download failed: check internet connection')
    console.log('   - Timeout: increase timeout in audioAnalysis.ts')
  }
}

// Run the script
const options = parseArgs()
reanalyzeAll(options)
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
