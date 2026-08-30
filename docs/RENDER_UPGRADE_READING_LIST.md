# Rendering System Upgrade - Reading List

This document provides a comprehensive reading list for refactoring the shadow/line-of-sight rendering system in Wall & Shadow.

## 📊 Current State Analysis

**Current Implementation:**
- **Three.js version**: r163 (from late 2023)
- **Current approach**: Custom shader-based LoS with multiple render targets (up to 8), manual composition
- **Known issues**:
  - AMD rendering bugs mentioned in TODOs
  - Mystery artifacts in square grids ([drawingOrtho.ts:382](../was-web/src/models/three/drawingOrtho.ts#L382))
  - `checkLoS()` noted as "really messed up" ([los.ts:252](../was-web/src/models/three/los.ts#L252))
  - Complex multi-camera setup (main, LoS, fixed, overlay)
  - Multiple scenes requiring sequential composition

---

## 🎨 Modern Three.js Capabilities (2025)

### Three.js Latest Features

**Official Documentation:**
- **Three.js Docs** - https://threejs.org/docs/
  - Current version: r172+ (January 2025)
  - Major improvements since your r163

**1. WebGPU Renderer & TSL (Three Shading Language)**
- **Three.js Shading Language (TSL)** - https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language
  - Node-based shader composition (more maintainable than raw GLSL)
  - JavaScript-based shader authoring with type safety
  - Better compatibility with WebGPU backend

- **Migration Guide** - https://github.com/mrdoob/three.js/wiki/Migration-Guide
  - Details on upgrading from r163 → r172+
  - WebGL vs WebGPU considerations

- **Field Guide to TSL and WebGPU** - https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
  - Practical examples of TSL node composition
  - How to structure shaders modularly

**2. Modern Post-Processing System**
- **EffectComposer Docs** - https://threejs.org/docs/examples/en/postprocessing/EffectComposer.html
  - Traditional approach (still supported in WebGL)

- **New WebGPU PostProcessing Class** - Mentioned in searches (2025 feature)
  - Simplified API: `const composer = new THREE.PostProcessing(renderer)`
  - Uses `pass()` function and TSL nodes instead of traditional passes
  - Example from search: `postProcessing.outputNode = scenePass`

**3. Render Target Improvements**
- **Render Targets Manual** - https://threejs.org/manual/en/rendertargets.html
  - Comprehensive guide to WebGLRenderTarget usage
  - Ping-pong buffers, MRT patterns

- **Multiple Render Targets (MRT)** - https://threejs.org/examples/webgpu_multiple_rendertargets.html
  - New TSL-based MRT syntax
  - Better than managing 8 separate render targets manually
  - Example: `scenePass.setMRT(mrt({ output: output, visibility: visibility }))`

- **WebGL Render Targets Article** - https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/
  - In-depth tutorial on render target composition patterns
  - Ping-pong techniques, feedback effects

**4. Advanced Post-Processing Library**
- **pmndrs/postprocessing** - https://github.com/pmndrs/postprocessing
  - 25,600+ dependents, actively maintained
  - **Key advantage**: EffectPass merges multiple effects into single render operation
  - Much more efficient than chaining passes
  - 20+ built-in effects (bloom, SSAO, etc.)
  - Could replace your manual filter composition

---

## 🌑 Shadow & Line-of-Sight Techniques for 2D/2.5D

### Classic 2D Visibility Algorithms

**1. Raycasting Approaches (Most Relevant for VTT)**
- **"Sight & Light" by Nicky Case** - https://ncase.me/sight-and-light/
  - ⭐ **Essential reading** - interactive tutorial
  - Explains 2D visibility from first principles
  - Shows raycasting to vertices algorithm
  - Perfect for tabletop VTT use cases

- **"2D Visibility" by Red Blob Games** - https://www.redblobgames.com/articles/visibility/
  - More mathematical approach to same problem
  - Covers edge-angle sorting, ray-segment intersection
  - Code examples and visualizations

- **"Field of View and Line of Sight in 2D"** - https://legends2k.github.io/2d-fov/design.html
  - Comparison of different algorithms (performance vs precision)
  - Vision distance, angle-of-vision calculations
  - Occlusion queries

**2. VTT-Specific Implementations**
- **Foundry VTT Token Visibility** - https://github.com/caewok/fvtt-token-visibility
  - Production VTT with similar requirements
  - Multiple LOS algorithm options (Points, Bresenham, etc.)
  - Performance comparisons

- **Terrain Height Tools (Foundry VTT)** - https://github.com/Wibble199/FoundryVTT-Terrain-Height-Tools
  - Handles elevation in 2D/isometric contexts
  - Grid cell height painting
  - Could inform wall height features

- **Bresenham for Raycasting** - https://deepnight.net/tutorial/bresenham-magic-raycasting-line-of-sight-pathfinding/
  - Fast grid-based LOS checks
  - Alternative to ray-polygon intersection

### Shadow Mapping for 2D/Isometric

**3. Orthographic Shadow Techniques**
- **"Shadow Mapping for Isometric Games"** - https://mflerackers.wordpress.com/2012/12/14/shadow-mapping-for-isometric-games/
  - Orthographic camera shadow mapping
  - Encoding depth in RGBA (for devices without depth texture support)
  - Top-down light direction simplifications

- **"Faking Shadows in 2D Isometric Games"** - https://www.psychicsoftware.com/2017/faking-shadows-and-lights-in-a-2d-game/
  - Fake shadow sprites with skew shaders
  - Lightweight alternative to full shadow mapping
  - Per-light shadow casting

- **"2D Isometric Shadows in Godot 4"** - https://blog.sethpyle.com/blog/2d_isometric_shadows/shadows/
  - SHADOW_VERTEX shader approach
  - Modern shader-based 2D shadows
  - Translatable to Three.js concepts

**4. Stencil Buffer Techniques**
- **"Tutorial 40: Stencil Shadow Volume"** - https://www.ogldev.org/www/tutorial40/tutorial40.html
  - Classic 3D technique adaptable to 2D
  - Sharp, per-pixel accurate shadows
  - Multipass rendering approach

- **"WebGL 2D Shadow Volumes"** - https://github.com/aw32/shadows2d
  - Working WebGL implementation of shadow volumes in 2D
  - Visualizes stencil buffer
  - Could replace your current approach

- **"WebGL2 Stencil Shadow Volumes (No Geometry Shaders)"** - https://github.com/ahillss/webgl2-stencil-shadow-volumes
  - GPU-based shadow volumes without geometry shaders
  - [Live demo available](https://ahillss.github.io/webgl2-stencil-shadow-volumes/)
  - More maintainable than custom vertex shader edge projection

- **"2D Lighting with Hard Shadows"** - https://slembcke.github.io/SuperFastHardShadows
  - Performance-focused approach
  - Grid-friendly algorithm

---

## 🏗️ Architecture Patterns & Modular Design

### Rendering Architecture

**1. Modular Rendering Pipeline**
- **"Design of Modular Rendering Pipeline" (ResearchGate)** - https://www.researchgate.net/publication/4292643_Design_of_Modular_Rendering_Pipeline
  - Component-based pipeline architecture
  - Visual programming concepts
  - Prototyping rendering effects quickly

- **"Designing a Modern Rendering Engine" (TU Wien Thesis)** - https://www.cg.tuwien.ac.at/research/publications/2007/bauchinger-2007-mre/bauchinger-2007-mre-Thesis.pdf
  - Academic deep-dive into rendering engine patterns
  - Effect frameworks and graph structures
  - Scene graph organization

- **"Shader Programming Architecture Patterns"** - https://www.byteplus.com/en/topic/176283
  - Modularity for shader code reuse
  - Rendering pipeline pattern (data flow)
  - Separation of concerns in shaders

**2. Component/System Patterns**
- **"Entity Component System FAQ"** - https://github.com/SanderMertens/ecs-faq
  - Understanding ECS architecture
  - Separating rendering from game logic

- **"Spatial Partition Pattern"** - https://gameprogrammingpatterns.com/spatial-partition.html
  - Essential reading from "Game Programming Patterns"
  - When/how to use quadtrees for culling
  - Object management strategies

**3. General Architecture Guidance**
- **"Patterns of Modular Architecture"** - https://dzone.com/refcardz/patterns-modular-architecture
  - Decomposing monolithic systems
  - Dependency management
  - Interface design for modules

- **"Guide to Modern Frontend Architecture Patterns"** - https://blog.logrocket.com/guide-modern-frontend-architecture-patterns/
  - Modular architecture in web contexts
  - Testability and maintainability
  - Isolated module development

---

## ⚡ Performance & Optimization

### Spatial Partitioning for Culling

**1. Quadtrees for 2D**
- **"The Magic of Quad Trees"** - https://www.zachmakesgames.com/node/22
  - Practical implementation guide
  - When quadtrees help (and when they don't)

- **"Spatial Partitioning with Quadtrees"** - https://carlosupc.github.io/Spatial-Partitioning-Quadtree/
  - Interactive examples
  - Recursive subdivision strategies

- **"Optimizing Subdivisions in Spatial Data Structures"** - https://cesium.com/blog/2017/03/30/spatial-subdivision/
  - Choosing subdivision depth
  - Adaptive vs fixed subdivision

**2. General Spatial Techniques**
- **"Notes on Spatial Partitioning"** - https://www.tulrich.com/geekstuff/partitioning.html
  - Comparison of quadtree, k-d tree, BSP tree
  - Trade-offs for different scene types

- **"Overview of Quadtrees, Octrees, and Hierarchical Data Structures"** - https://www.cs.umd.edu/~hjs/pubs/Samettfcgc88-ocr.pdf
  - Academic comprehensive overview
  - Mathematical foundations

### Progressive Enhancement & Fallbacks

**3. Compatibility Strategies**
- **"Progressive Enhancement with WebGL and React"** - https://14islands.com/blog/progressive-enhancement-with-webgl-and-react
  - Graceful degradation patterns
  - Canvas 2D fallbacks
  - Feature detection

- **"Cross-Browser Compatibility in WebGL"** - https://blog.pixelfreestudio.com/best-practices-for-cross-browser-compatibility-in-webgl/
  - WebGL 1.0 vs 2.0 fallbacks
  - Extension detection
  - Alternative rendering paths

---

## 🎯 Recommended Reading Order

For your specific refactoring task, I suggest this sequence:

### Phase 1: Understanding Modern Approaches (Week 1)
1. **Nicky Case's "Sight & Light"** - Understand the problem space
2. **Three.js Migration Guide** - See what's new since r163
3. **pmndrs/postprocessing README** - Understand modern composition patterns
4. **WebGL Render Targets Tutorial** (Maxime Heckel) - Master render target patterns

### Phase 2: Evaluating Techniques (Week 1-2)
5. **Red Blob Games 2D Visibility** - Compare algorithm options
6. **WebGL 2D Shadow Volumes demo** - See stencil buffer approach
7. **Shadow Mapping for Isometric Games** - Consider shadow map alternative
8. **Foundry VTT Token Visibility source** - Study production VTT implementation

### Phase 3: Architecture Planning (Week 2)
9. **Modular Rendering Pipeline paper** - Plan new architecture
10. **Spatial Partition Pattern** (Game Programming Patterns) - Add culling strategy
11. **Shader Programming Architecture Patterns** - Structure shader code
12. **Field Guide to TSL** - Consider modern shader approach

### Phase 4: Implementation Resources (During Development)
13. **Three.js EffectComposer docs** - Reference during implementation
14. **Three.js Shading Language wiki** - If adopting TSL
15. **Progressive Enhancement articles** - Plan fallback strategies

---

## 💡 Key Takeaways for Your Refactor

Based on your current implementation issues:

### Architecture Improvements
1. **Replace custom render target juggling** with EffectComposer or pmndrs/postprocessing
2. **Consider TSL** for more maintainable shaders (vs raw GLSL)
3. **Consolidate cameras** - your 4-camera setup could likely be simplified
4. **Separate concerns** - LoS calculation vs application as separate, composable passes

### Technique Options
1. **Raycasting to vertices** (Nicky Case approach) - Simpler, more debuggable
2. **Stencil shadow volumes** - Hardware-accelerated, sharp shadows
3. **Shadow mapping with orthographic camera** - Industry standard, well-understood
4. **Hybrid**: Use different techniques for different quality settings

### Performance Wins
1. **Spatial partitioning** - Only calculate LoS for visible tokens
2. **Effect merging** - pmndrs/postprocessing combines passes automatically
3. **MRT usage** - Output multiple values in one pass (visibility, depth, etc.)

### Maintainability
1. **Modular pipeline** - Easy to A/B test different LoS algorithms
2. **Progressive enhancement** - Fallback for older devices/browsers
3. **Better testing** - Isolated LoS module easier to unit test

---

## 📝 Additional Context

### Current Implementation Details

**Files Involved:**
- [src/models/three/los.ts](../was-web/src/models/three/los.ts) - Core LoS implementation with shader-based shadow casting
- [src/models/three/losFilter.ts](../was-web/src/models/three/losFilter.ts) - Pixel-shader based LoS filtering
- [src/models/three/drawingOrtho.ts](../was-web/src/models/three/drawingOrtho.ts) - Main rendering orchestration
- [src/models/three/renderTargetReader.ts](../was-web/src/models/three/renderTargetReader.ts) - Helper for reading render target pixels

**Current Architecture:**
- **Two-stage approach**:
  1. Feature-based rendering (los.ts) - renders walls as LoS blockers
  2. Filter-based application (losFilter.ts) - applies composed LoS as full-screen shader
- **Multiple render targets**: Up to 8 feature render targets + compose target
- **Four cameras**: Main orthographic, LoS, fixed, overlay
- **Six scenes**: image, map, fixedFilter, filter, fixedHighlight, overlay

**Known Pain Points (from TODOs):**
- TODO #56: `checkLoS()` needs complete overhaul
- TODO #52: LoS camera needs own downscaling camera
- TODO #197: Layer interaction problems with player areas
- TODO #197: Suggests rendering to back buffers then composing
- TODO #160: Grid LoS legacy code should be removed

---

*Document created: 2025-12-26*
*For: Wall & Shadow rendering system refactoring*
