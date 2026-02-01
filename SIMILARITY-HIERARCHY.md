# Similarity-Based Sample Hierarchy

## Overview

The similarity hierarchy feature automatically organizes your sample library into a tree structure based on audio similarity, making it easier to discover related sounds and browse your collection semantically rather than alphabetically.

## How It Works

**Backend (Automatic)**
- Uses YAMNet embeddings (1024-dimensional vectors) from Phase 4 analysis
- Applies agglomerative clustering to group similar samples
- Merges closest clusters iteratively until reaching 5-10 top-level groups
- Returns a tree structure where similar samples are nested together

**API Endpoint**
```
GET /api/slices/hierarchy
```

**Response Structure**
```json
{
  "hierarchy": [
    {
      "type": "cluster",
      "id": "cluster_...",
      "size": 42,
      "children": [
        {
          "type": "sample",
          "id": "sample_123",
          "sliceId": 123,
          "name": "Kick Drum 1",
          "trackTitle": "Drum Kit"
        },
        // ... more samples or sub-clusters
      ]
    }
  ],
  "totalClusters": 7,
  "totalSamples": 150
}
```

## Visualization Ideas

### Option 1: Tree View (Expandable Folders)
```
📁 Cluster 1 - Drums (42 samples)
  ├─ 📁 Kicks (15 samples)
  │   ├─ 🔊 Deep Kick 1
  │   ├─ 🔊 Deep Kick 2
  │   └─ 🔊 Punchy Kick
  └─ 📁 Snares (12 samples)
      ├─ 🔊 Snare Crisp
      └─ 🔊 Snare Deep
```

### Option 2: Force-Directed Graph
- Nodes = samples
- Links = similarity strength
- Clusters form natural groupings through physics simulation

### Option 3: Radial Dendrogram
- Center = root
- Branches = clusters
- Leaves = individual samples

## UI Integration Suggestions

**Location**: New tab in Sources view ("Organize by Similarity")

**Features**:
- Click cluster to expand/collapse
- Hover sample to preview audio
- Drag samples to collections
- Right-click for context menu (play, add to collection, etc.)

**Performance**:
- For >2000 samples: ~2-10 seconds to compute
- Cache results client-side
- Optionally: pre-compute on server and store

## Use Cases

1. **Discovery**: "Show me all samples similar to this kick drum"
2. **Organization**: Automatically group drum kits, synth patches, vocals, etc.
3. **Cleanup**: Identify clusters with too many similar samples
4. **Inspiration**: Browse related sounds you might not find by tag alone

## Implementation Status

- ✅ Backend API endpoint (`/api/slices/hierarchy`)
- ✅ Clustering algorithm (agglomerative clustering)
- ❌ Frontend visualization component
- ❌ UI integration in Sources view

## Next Steps

1. Choose visualization approach (tree view recommended for MVP)
2. Create `SimilarityHierarchy.tsx` component
3. Add "Similarity" tab to Sources view
4. Implement expand/collapse interactions
5. Add audio preview on hover
6. Test with various library sizes
