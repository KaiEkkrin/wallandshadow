# Rust + WASM Viability Assessment for Wall & Shadow

Research document evaluating the feasibility of rewriting Wall & Shadow's data and graphics layers in Rust, compiled with WebAssembly, while keeping the React UI in TypeScript.

**Date**: 2025-12-26
**Current Stack**: TypeScript + React + Three.js + Firebase
**Proposed Stack**: Rust (data/graphics) + WASM + TypeScript (React UI) + Firebase

---

## 📋 Executive Summary

### Viability: **HIGH** ✅

Rust + WASM is a viable and increasingly production-ready option for rewriting Wall & Shadow's data and graphics layers. The ecosystem has matured significantly in 2024-2025, with strong tooling, proven case studies, and excellent WASM support.

### Key Strengths
- **wgpu.rs** is production-ready, used by Firefox, Deno, and commercial games
- **WASM tooling** is mature (wasm-bindgen, wasm-pack) with automatic TypeScript generation
- **React integration** is well-documented with multiple successful patterns
- **Type safety & correctness** benefits are significant for complex grid/geometry logic
- **Performance** improvements of 1.5-10x possible for computational workloads

### Key Challenges
- **Firebase/Firestore**: Limited Rust client libraries; requires JS SDK bridge or server-side approach
- **Binary size**: WASM bundles can be 8-15MB even with optimization (vs ~500KB for TypeScript)
- **Developer experience**: Slower compile times than TypeScript; debugging still maturing
- **Team expertise**: Requires Rust knowledge; steeper learning curve than TypeScript

### Recommendation
**Incremental adoption** is the best strategy:
1. Start with **data layer** (geometry, grid calculations, collision detection)
2. Migrate **graphics rendering** to wgpu.rs if data layer succeeds
3. Keep **React UI** and **Firebase integration** in TypeScript
4. Use **hybrid approach** with WASM for compute-heavy operations

---

## 🎨 wgpu.rs & Graphics Ecosystem

### wgpu.rs Status (2025)

**What is wgpu?**
- Safe, portable graphics library for Rust based on WebGPU API
- Targets: Vulkan, Metal, DirectX 12, OpenGL ES (native) + WebGPU/WebGL2 (web via WASM)
- Official WebGPU implementation for Firefox, Servo, and Deno
- **Production-ready** with active development

**Resources:**
- **Official Site** - https://wgpu.rs/
- **GitHub** - https://github.com/gfx-rs/wgpu (11.5k+ stars)
- **Docs** - https://docs.rs/wgpu/
- **Learning** - https://sotrh.github.io/learn-wgpu/ (Learn WGPU tutorial)

**Adoption:**
- **Game Engines**: Bevy, Fyrox, Macroquad use wgpu as their renderer
- **Commercial Games**: "Townscaper" WASM port runs on wgpu
- **Browser Vendors**: Firefox ships wgpu as official WebGPU implementation

**Recent Developments (2025):**
- September 2025 guides on browser-based games with Rust + WebGPU + WASM
- Near-native performance in browsers via WASM compilation
- Cross-platform: same code runs natively and in web browsers

### Rust Game Engines with 2D + WASM Support

#### Bevy
- **URL**: https://bevyengine.org/
- **Status**: Production-ready, 18k+ GitHub stars
- **WASM Support**: Yes, with WebGL2 and WebGPU backends
- **Architecture**: ECS-based, data-driven, modular
- **Bundle Size**: 15-30MB optimized (see size optimization section)
- **Performance**: WebAssembly slower than native; no multithreading yet
- **Best For**: Complex games, VTT applications with many entities

**Resources:**
- **WASM Guide** - https://bevy-cheatbook.github.io/platforms/wasm.html
- **Examples** - https://bevy.org/examples/ (live WebGL2 demos)
- **Tutorial** - https://codezup.com/rust-wasm-games-bevy-tutorial/

#### Fyrox
- **URL**: https://fyrox.rs/
- **Status**: Production-ready with scene editor
- **WASM Support**: Windows, Linux, macOS, WebAssembly
- **Best For**: 2D/3D games with visual editor

#### Macroquad
- **Status**: Lightweight, beginner-friendly
- **WASM Support**: Yes, simple deployment
- **Best For**: Simple 2D games, learning Rust gamedev

#### Custom wgpu Renderer
- **Pros**: Full control, minimal overhead, tailored to VTT needs
- **Cons**: More implementation work than using an engine
- **Best For**: Specialized rendering pipelines (like your grid-based system)

**Resources:**
- **Zero to WASM Guide** - https://codezup.com/zero-to-wasm-create-browser-based-games-with-rust-and-webgpu/
- **wgpu on Web** - https://gfx-rs.github.io/2020/04/21/wgpu-web.html

---

## 🔧 WASM Tooling & Maturity

### Build Toolchain

**wasm-bindgen** - Core interop layer
- High-level interactions between WASM and JavaScript
- Automatically generates TypeScript definitions (.d.ts files)
- URL: https://rustwasm.github.io/wasm-bindgen/

**wasm-pack** - Build tool
- Manages wasm-bindgen build, generates npm-ready packages
- Automatic JavaScript/TypeScript wrapper generation
- Handles ABI conversions and memory management
- URL: https://rustwasm.github.io/wasm-pack/

**Build Process:**
```bash
# In Rust crate
wasm-pack build --target web

# Generates:
# - pkg/my_crate.js
# - pkg/my_crate_bg.wasm
# - pkg/my_crate.d.ts (TypeScript definitions!)
```

### Type Safety

**Automatic TypeScript Generation:**
- wasm-pack generates .d.ts files from Rust types
- Full type safety across WASM boundary
- serde + serde-wasm-bindgen for complex types

**Example:**
```rust
#[wasm_bindgen]
pub struct GridCoord {
    pub q: i32,
    pub r: i32,
}

#[wasm_bindgen]
pub fn get_neighbors(coord: &GridCoord) -> Vec<GridCoord> {
    // ...
}
```

Generates TypeScript:
```typescript
export class GridCoord {
  q: number;
  r: number;
}
export function get_neighbors(coord: GridCoord): GridCoord[];
```

**Resources:**
- **Share Types Guide** - https://dawchihliou.github.io/articles/share-rust-types-with-typescript-for-webassembly-in-30-seconds
- **Serde-WASM-Bindgen** - https://github.com/cloudflare/serde-wasm-bindgen

---

## ⚛️ React + Rust WASM Integration

### Integration Patterns

**Three approaches identified:**

1. **Published NPM Modules** (Recommended for stable libraries)
   - Build Rust crate with wasm-pack
   - Publish to npm registry
   - Import like any npm package
   - **Best for**: Reusable libraries, stable APIs

2. **Monorepo Setup** (Recommended for active development)
   - Rust crate alongside React app in monorepo
   - wasm-pack-plugin auto-builds on changes
   - Live reload workflow
   - **Best for**: Tight integration, rapid iteration

3. **Build Plugin Integration**
   - Vite or Webpack plugin manages WASM builds
   - Automatic rebuilds with file watchers
   - **Best for**: Mixed TypeScript/Rust projects

### Modern Build Tools

**Vite (Recommended)**
- Simpler WASM integration than create-react-app
- Built-in WASM support
- Fast HMR (Hot Module Replacement)

**Webpack v5/CRA**
- Requires @craco/craco for WASM customization
- More configuration overhead

### Usage Pattern in React

```typescript
import init, { compute_line_of_sight } from 'wall-shadow-core';

function MapComponent() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Initialize WASM module
    init().then(() => setReady(true));
  }, []);

  const handleTokenMove = (tokenId, gridCoord) => {
    if (!ready) return;

    // Call Rust function
    const visibleCells = compute_line_of_sight(gridCoord, walls);
    updateVisibility(visibleCells);
  };

  // ...
}
```

**Resources:**
- **React + Rust Tutorial** - https://www.tkat0.dev/posts/how-to-create-a-react-app-with-rust-and-wasm/
- **CRA Monorepo Guide** - https://cmdcolin.github.io/posts/2022-08-22-rustwasm/
- **Fullstack React Guide** - https://www.newline.co/fullstack-react/articles/rust-react-and-web-assembly/
- **Vite + Rust Setup** - https://dev.to/krzysztofkaczy9/webassembly-rust-typescript-project-setup-4gio

---

## 🔥 Firebase/Firestore Integration

### Current Status: **Limited** ⚠️

No mature, production-ready Firestore client library for Rust WASM exists as of December 2025.

### Available Options

#### 1. JavaScript SDK Bridge (Recommended)

**Approach**: Use wasm-bindgen to call Firebase JS SDK from Rust

**Libraries:**
- **firebase-wasm-rs** - https://github.com/jquesada2016/firebase-wasm-rs
  - Rust bindings for Firebase v9 JS SDK
  - ⚠️ Early stage, incomplete API coverage
  - Requires Firebase JS SDK loaded via CDN

- **firebase-js-rs** - https://github.com/wa1aric/firebase-js-rs
  - Unofficial WASM bindings for Firebase JS SDKs
  - Requires manual JS SDK installation

**Pros:**
- Uses official Firebase SDKs (no reimplementation)
- Access to all Firebase features
- Automatic SDK updates

**Cons:**
- Bindings incomplete
- JS SDK bloat in final bundle
- Less idiomatic Rust
- Potential performance overhead (JS ↔ Rust boundary crossings)

#### 2. Keep Firebase in TypeScript (Recommended for Now)

**Approach**: Rust handles data/graphics; TypeScript handles Firebase

**Architecture:**
```
TypeScript (React)
  ├─ Firebase SDK (queries, subscriptions, auth)
  └─ WASM (Rust)
      ├─ Grid geometry calculations
      ├─ Line-of-sight rendering
      ├─ Collision detection
      └─ Data structures (pass to/from TypeScript)
```

**Data Flow:**
1. TypeScript fetches data from Firestore
2. Deserialize to TypeScript types
3. Pass to Rust WASM functions as needed
4. Rust processes and returns results
5. TypeScript updates Firestore

**Pros:**
- Clean separation of concerns
- Use mature Firebase SDK
- Minimal WASM boundary crossings
- Easier to maintain

**Cons:**
- Rust doesn't "own" data layer completely
- Some serialization overhead
- Data models duplicated (TypeScript + Rust)

#### 3. Server-Side Firestore (Alternative)

**firestore_grpc** - https://lib.rs/crates/firestore_grpc
- gRPC client for Firestore
- Server-side only (not WASM-compatible)
- Could use for Cloud Functions in Rust

**Use Case**: If you move Firebase Functions to Rust (advanced)

### Recommendation

**For initial migration:**
- Keep Firebase/Firestore in TypeScript
- Use Rust for compute-intensive operations (geometry, rendering)
- Pass data across WASM boundary as needed

**Future possibilities:**
- Watch firebase-wasm-rs development
- Consider GraphQL/REST API layer between Rust and Firebase
- Evaluate server-side Rust (Cloud Run) for backend logic

**Resources:**
- **Firebase WASM Discussion** - https://groups.google.com/g/firebase-talk/c/1p5-Sv9KVQY

---

## ⚡ Performance Considerations

### Performance Benchmarks

**WASM vs TypeScript/JavaScript:**

Results vary significantly by workload:

**Strong WASM Advantages (5-10x faster):**
- Heavy numerical computation (physics, matrix math)
- Algorithmic complexity (pathfinding, graph algorithms)
- Memory-intensive operations (large data processing)
- Example: FaaS runtime 70% faster, 90% less memory than Node.js

**Modest WASM Advantages (1.2-2x faster):**
- Mixed workloads
- Example: 20% average speedup for typical Rust vs JS implementations

**Cases Where JavaScript Wins:**
- DOM manipulation (always faster in JS)
- Simple calculations (compiler optimizations competitive)
- JSON parsing (native JS parser highly optimized)
- Example: JS 10x faster for linear regression, 30% faster for Levenshtein distance

**Key Insight**: Design decisions matter more than language. Well-written TypeScript often outperforms naive Rust.

### WASM Binary Size

**Challenge**: WASM bundles are large

**Typical Sizes:**
- Minimal "Hello World": ~200KB
- Small app with wgpu: 5-10MB
- Bevy game: 15-30MB (optimized)
- Three.js bundle (comparison): ~500KB

**Size Optimization Techniques:**

1. **Cargo Profile** (Cargo.toml):
```toml
[profile.release]
opt-level = "z"        # Optimize for size
lto = true             # Link-time optimization
codegen-units = 1      # Max size reduction
strip = true           # Strip debug symbols
```

2. **wasm-opt** Post-Processing:
- 15-20% additional size reduction
- Part of Binaryen toolkit
- Run automatically via wasm-pack

3. **Compression**:
- WASM compresses to <50% with gzip/brotli
- Example: 15MB → 7-8MB compressed
- Always serve compressed in production

4. **wasm-slim** (New in Nov 2025):
- Automated optimization tool
- 60%+ size reduction possible
- URL: https://lib.rs/crates/wasm-slim

5. **Build-std** (Advanced):
- Recompile std library with size optimizations
- Requires nightly Rust

**Case Study: Warp Terminal**
- Reduced WASM from 21.4MB → 8MB (gzipped)
- Techniques: cargo profile + async asset loading
- URL: https://www.warp.dev/blog/reducing-wasm-binary-size

**Trade-offs:**
- Size optimization increases compile time
- May reduce runtime performance slightly
- Binary splitting helps (load features on-demand)

**Resources:**
- **Official Size Guide** - https://rustwasm.github.io/book/reference/code-size.html
- **Leptos Optimization** - https://book.leptos.dev/deployment/binary_size.html
- **Size Optimization Guide** - https://github.com/johnthagen/min-sized-rust

### Memory Efficiency

**Advantage: Rust**
- No garbage collection pauses
- Predictable memory usage
- Better cache locality
- Example: 90% memory reduction vs Node.js in FaaS benchmark

### Computational Performance

**For Wall & Shadow specifically:**

**High performance gains expected:**
- ✅ **Hexagon grid math** - Heavy arithmetic, ideal for Rust
- ✅ **Line-of-sight calculations** - Raycasting, geometry intersections
- ✅ **Collision detection** - Spatial queries, bounding box tests
- ✅ **Pathfinding** - Graph algorithms (if implemented)

**Modest or no gains:**
- ⚠️ **Firestore queries** - Network-bound, not compute-bound
- ⚠️ **DOM updates** - React still in TypeScript
- ⚠️ **JSON serialization** - serde-wasm-bindgen competitive but not always faster

**Resources:**
- **Real-World Benchmark** - https://medium.com/@torch2424/webassembly-is-fast-a-real-world-benchmark-of-webassembly-vs-es6-d85a23f8e193
- **Performance Discussion** - https://news.ycombinator.com/item?id=32106953
- **2025 Benchmarks** - https://byteiota.com/rust-webassembly-performance-8-10x-faster-2025-benchmarks/

---

## 🛠️ Developer Experience & Tooling

### Development Workflow

**Compile Times:**
- **TypeScript**: <1 second for incremental builds
- **Rust (incremental)**: 2-10 seconds for small changes
- **Rust (clean build)**: 30-120 seconds depending on dependencies
- **wgpu projects**: +30-60 seconds (large dependency tree)

**Hot Reload:**
- Possible but not as seamless as TypeScript HMR
- Fast iteration workflow: ~1-2 seconds save-to-browser
- Dynamic library approach for sub-second reloads (experimental)

**Resources:**
- **Fast WASM Workflow** - https://1danielcoelho.github.io/fast-rust-wasm-workflow/
- **Hot Reload Example** - https://github.com/shekohex/rust-wasm-hotreload
- **wgpu Hot Reload Template** - https://github.com/Azkellas/rust_wgpu_hot_reload

### Debugging

**Browser Debugging:**
- Chrome DevTools supports WASM debugging
- Requires C++ DevTools Support extension
- DWARF debug info embedded in WASM (with --debug flag)
- Source maps available via wasm-pack --dev

**Logging:**
- console_error_panic_hook - Panics to console.error
- wasm_logger / gloo_console - Logging to browser console
- web-sys::console for direct console access

**Challenges:**
- Debugging experience less mature than TypeScript
- No hot variable inspection (yet)
- Stack traces can be cryptic

**Resources:**
- **Debugging Guide** - https://rustwasm.github.io/book/reference/debugging.html
- **Chrome DevTools** - https://blog.bitsrc.io/debugging-webassembly-with-chrome-devtools-99dbad485451
- **VSCode Debugging** - https://www.hecatron.com/posts/2024/rust-wasm-debug/

### Tooling Maturity: **GOOD** ✅

- **IDE Support**: rust-analyzer (excellent), VS Code integration
- **Package Management**: Cargo (superior to npm in many ways)
- **Testing**: cargo test, wasm-pack test (browser-based tests)
- **Profiling**: Chrome DevTools profiler works with WASM
- **Linting**: clippy (catches many bugs at compile time)

---

## 🏆 Production Case Studies

### Major Companies Using Rust WASM

**Disney**
- NCP GUI framework (Native Client Platform v2 "m5")
- Targets WASM for web deployment
- Same rendering engine: handheld → TV → web
- 3 years in development, now production

**Discord**
- Read States service rewritten in Rust
- Eliminated Go GC latency spikes
- NIFs (Native Implemented Functions) for Elixir integration

**Cloudflare**
- CDN edge logic in Rust WASM
- 10-15% request throughput increase
- Workers platform runs WASM at edge

**Dropbox**
- File sync engine partial migration
- 50% CPU usage reduction
- Lower cloud infrastructure costs

**Figma**
- Not full WASM, but uses WASM for performance-critical code
- 3x faster rendering for some operations

**Google Starlark**
- Configuration language interpreter in Rust → WASM
- Sub-10ms cold starts

**E-Commerce Platform**
- 40% smaller JavaScript payload
- 30% faster Time to Interactive

**Web3 / Blockchain**
- Solana, NEAR, Internet Computer, Aptos
- Smart contracts in Rust compiled to WASM

**Resources:**
- **Rust Companies** - https://serokell.io/blog/rust-companies
- **Case Studies** - https://moldstud.com/articles/p-real-world-rust-applications-inspiring-case-studies-and-success-stories

---

## 🔄 Migration Strategies

### Incremental Migration (Recommended)

**Don't rewrite everything at once.** Start small with high-value, low-risk components.

### Phase 1: Proof of Concept (2-4 weeks)

**Target**: Grid geometry calculations

**Scope:**
- Port `GridCoord`, `GridEdge`, `GridVertex` types to Rust
- Port `hexGridGeometry.ts` or `squareGridGeometry.ts`
- Expose functions to TypeScript:
  - `get_neighbors(coord) -> Vec<GridCoord>`
  - `coord_to_pixel(coord) -> (f32, f32)`
  - `pixel_to_coord(x, y) -> Option<GridCoord>`
  - `line_between(start, end) -> Vec<GridCoord>`

**Success Criteria:**
- TypeScript integration works seamlessly
- Performance equal or better than TypeScript
- Bundle size acceptable (<2MB)
- Team comfortable with Rust workflow

**Rollback Plan**: Keep TypeScript version, abandon Rust if PoC fails

### Phase 2: Data Layer (1-2 months)

If Phase 1 succeeds:

**Scope:**
- Port `coord.ts`, `feature.ts`, `tokens.ts` types
- Collision detection / spatial queries
- Line-of-sight algorithm (before rendering)
  - Raycasting to wall edges
  - Visibility polygon calculation
- Change tracking data structures (if performance-critical)

**Keep in TypeScript:**
- Firebase integration
- React state management
- UI event handlers

### Phase 3: Graphics Layer (2-4 months)

If Phase 2 succeeds and performance demands it:

**Scope:**
- Build wgpu renderer for grid/walls/tokens
- Replace Three.js entirely, or
- Hybrid: wgpu for LoS/grid, Three.js for tokens/images

**Challenges:**
- Larger effort than data layer
- wgpu learning curve steep
- May need custom shaders

**Alternative**: Keep Three.js, use Rust only for LoS calculations

### Phase 4: Advanced Features (Future)

- Pathfinding (A*, Dijkstra)
- Physics simulation
- Procedural map generation
- AI for NPCs

### Migration Patterns

**Strangler Fig Pattern:**
- Gradually replace old code with new
- Both systems coexist during migration
- Old code deleted incrementally

**Parallel Implementation:**
- Implement new feature in Rust
- Compare against TypeScript version
- Switch when confident

**Feature Flags:**
- Runtime toggle between TypeScript/Rust implementations
- Gradual rollout to users
- Easy rollback if issues

**Resources:**
- **Migration Guide** - https://corrode.dev/learn/migration-guides/typescript-to-rust/
- **Incremental Migration Article** - https://nicolodavis.com/blog/typescript-to-rust/
- **Rust + TypeScript Integration** - https://flinect.com/blog/rust-wasm-with-typescript-serde

---

## 📚 Rust-Specific Libraries for VTT Use Cases

### 2D Geometry & Hex Grids

**hexx** - Hexagonal grid library
- URL: https://github.com/ManevilleF/hexx
- Inspired by Red Blob Games
- Axial coordinates (performance optimized)
- Conversions: cubic, doubled, hexmod, offset
- Features: distance, line drawing, rings, FOV
- **Highly relevant for Wall & Shadow**

**hex2d** - 2D hex map systems
- URL: https://lib.rs/crates/hex2d
- Based on Red Blob Games algorithms

**RGeometry** - Computational geometry
- URL: https://rgeometry.org/
- Points, polygons, lines, segments
- 2D algorithms: intersection, containment, etc.

**cgeo** - 2D computational geometry
- URL: https://github.com/chrissimpkins/cgeo
- Rust-native geometry primitives

**Resources:**
- **Hexagonal Keywords** - https://crates.io/keywords/hexagonal
- **Geometry Keywords** - https://crates.io/keywords/geometry

### Entity Component System (ECS)

If using Bevy or building custom architecture:

**Bevy ECS** (built-in to Bevy)
- Archetype-based storage
- Excellent performance
- Parallel query execution
- Used in production games

**hecs** - Minimalist ECS
- URL: https://github.com/Ralith/hecs
- High-performance, lightweight
- No "System" abstraction (query from regular code)
- Archetype-based

**specs** (Legacy)
- ⚠️ No longer maintained
- Component-based storage
- Avoid for new projects in 2025

**Resources:**
- **Are We Game Yet - ECS** - https://arewegameyet.rs/ecosystem/ecs/
- **ECS Comparison** - https://csherratt.github.io/blog/posts/specs-and-legion/

### Serialization

**serde** - Standard serialization framework
- De facto standard in Rust
- JSON, YAML, TOML, MessagePack, etc.
- Type-safe, compile-time checked

**serde-wasm-bindgen** - WASM-optimized serialization
- URL: https://github.com/cloudflare/serde-wasm-bindgen
- Faster than JSON for Rust ↔ JS
- Smaller code size
- 1.6x-3.3x performance vs JSON (workload-dependent)

**Performance:**
- For simple types: Use primitives directly (10x faster than serde)
- For complex types: serde-wasm-bindgen recommended
- Avoid over-serialization (keep hot paths primitive-heavy)

**Resources:**
- **Serde Guide** - https://dev.to/aaravjoshi/how-serde-transforms-rust-data-serialization-complete-performance-and-safety-guide-36f2
- **WASM Serialization** - https://medium.com/@wl1508/avoiding-using-serde-and-deserde-in-rust-webassembly-c1e4640970ca

---

## ⚖️ Pros & Cons Analysis

### Pros of Rust + WASM for Wall & Shadow

**Correctness & Safety:**
- ✅ **Type safety**: Catch bugs at compile time (grid coordinate errors, null checks, etc.)
- ✅ **Memory safety**: No null pointer exceptions, use-after-free, data races
- ✅ **Fearless refactoring**: Compiler guides you through changes
- ✅ **Better testing**: Strong types reduce test surface area

**Performance:**
- ✅ **Computational performance**: 1.5-10x faster for geometry, raycasting, math
- ✅ **Memory efficiency**: 90% memory reduction possible vs TypeScript
- ✅ **Predictable performance**: No GC pauses
- ✅ **Battery efficiency**: Lower CPU/power consumption

**Maintainability:**
- ✅ **Explicit error handling**: Result<T, E> forces handling errors
- ✅ **No implicit null**: Option<T> is explicit
- ✅ **Algebraic data types**: Enums for state machines
- ✅ **Pattern matching**: Exhaustive matching prevents missed cases

**Ecosystem:**
- ✅ **wgpu**: Modern, safe graphics API
- ✅ **hexx**: Production-ready hexagon library
- ✅ **Cargo**: Excellent package manager
- ✅ **Tooling**: rust-analyzer, clippy, rustfmt

**Long-term:**
- ✅ **Future-proof**: WebGPU is the future of web graphics
- ✅ **Cross-platform**: Same code for desktop app (Tauri) later
- ✅ **Growing ecosystem**: Rust gamedev maturing rapidly

### Cons of Rust + WASM for Wall & Shadow

**Development Velocity:**
- ❌ **Learning curve**: Rust is harder than TypeScript (ownership, lifetimes, traits)
- ❌ **Compile times**: 10-100x slower than TypeScript
- ❌ **Iteration speed**: Hot reload less mature
- ❌ **Debugging**: Browser debugging less polished than JS
- ❌ **Team expertise**: Requires Rust knowledge

**Integration Challenges:**
- ❌ **Firebase**: No mature Firestore client for WASM
- ❌ **React**: WASM boundary adds complexity
- ❌ **Serialization**: Crossing WASM boundary has overhead
- ❌ **Third-party libs**: Can't use npm ecosystem directly

**Binary Size:**
- ❌ **Large bundles**: 8-15MB typical (vs 500KB TypeScript)
- ❌ **Load time**: Slower initial page load (mitigated by compression)
- ❌ **Caching**: Larger cache footprint

**Ecosystem Gaps:**
- ❌ **Firebase**: Limited client libraries
- ❌ **DOM manipulation**: Always awkward from Rust
- ❌ **Browser APIs**: Require wasm-bindgen wrappers

**Risk:**
- ❌ **Rewrite risk**: Large upfront investment
- ❌ **Team risk**: What if Rust champion leaves?
- ❌ **Technology risk**: WASM/wgpu still evolving

---

## 🎯 Recommended Path Forward

### Short-Term (Next 3-6 Months)

**Focus on Three.js upgrade (per RENDER_UPGRADE_READING_LIST.md):**
1. Upgrade Three.js r163 → r172+
2. Adopt pmndrs/postprocessing for composition
3. Refactor LoS rendering (raycasting or stencil volumes)
4. Evaluate TSL (Three Shading Language) for shader maintainability

**Rust exploration (low-commitment):**
1. **Spike**: Port hexGridGeometry.ts to Rust + WASM (1 week)
2. **Benchmark**: Compare performance and bundle size
3. **Assess**: Team comfort level with Rust
4. **Decision**: Continue or stay with TypeScript

### Medium-Term (6-12 Months)

**If Rust spike is successful:**

**Phase 1: Data Layer in Rust**
- Grid geometry (hexx library or custom)
- Coordinate types
- Line-of-sight **calculation** (not rendering yet)
- Collision detection / spatial queries

**Keep in TypeScript:**
- React UI
- Firebase integration
- Three.js rendering (with improvements)

**Hybrid Architecture:**
```
TypeScript (React)
  ├─ Firebase SDK (data, auth)
  ├─ Three.js (rendering)
  └─ WASM (Rust)
      ├─ Grid geometry (hexx)
      ├─ LoS calculation
      ├─ Collision detection
      └─ Data structures
```

### Long-Term (12-24 Months)

**If data layer succeeds and performance demands it:**

**Phase 2: Graphics Layer in Rust**
- Evaluate wgpu vs continuing with Three.js
- If wgpu: Build custom 2D renderer
- If Three.js: Keep, use Rust only for calculations

**Alternative: Bevy**
- If VTT becomes full 2D game
- Built-in ECS for game logic
- wgpu renderer included
- Larger bundle size (15-30MB)

### Decision Tree

```
Start: Three.js r163, TypeScript

├─ Short-term: Upgrade Three.js (recommended)
│   └─ Problem solved? → DONE
│   └─ Still have issues? → Continue
│
├─ Spike: Rust WASM for grid geometry
│   ├─ Success? → Phase 1 (data layer)
│   │   ├─ Success? → Phase 2 (graphics layer)
│   │   └─ Failure? → Stay TypeScript + Three.js
│   │
│   └─ Failure? → Stay TypeScript + Three.js

Performance critical?
  Yes → Consider Rust data + graphics
  No → Stay TypeScript, focus on features
```

---

## 📖 Learning Resources

### Getting Started with Rust

**Fundamentals:**
- **The Rust Book** - https://doc.rust-lang.org/book/ (free, official)
- **Rust by Example** - https://doc.rust-lang.org/rust-by-example/
- **Rustlings** - https://github.com/rust-lang/rustlings (interactive exercises)

**Rust for TypeScript Developers:**
- **TypeScript to Rust Migration** - https://corrode.dev/learn/migration-guides/typescript-to-rust/

### Rust + WASM

**Official Guides:**
- **Rust and WebAssembly Book** - https://rustwasm.github.io/docs/book/
- **wasm-bindgen Guide** - https://rustwasm.github.io/wasm-bindgen/
- **MDN: Rust to WASM** - https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Rust_to_Wasm

**Tutorials:**
- **Game of Life Tutorial** - https://rustwasm.github.io/book/game-of-life/introduction.html
- **React + Rust WASM** - https://www.newline.co/fullstack-react/articles/rust-react-and-web-assembly/

### wgpu & Graphics

**Learning wgpu:**
- **Learn WGPU** - https://sotrh.github.io/learn-wgpu/ (comprehensive tutorial)
- **Official wgpu Examples** - https://github.com/gfx-rs/wgpu/tree/trunk/examples

**Game Development:**
- **Are We Game Yet?** - https://arewegameyet.rs/ (Rust gamedev ecosystem overview)
- **Bevy Book** - https://bevyengine.org/learn/book/introduction/
- **Rust Game Development Guide** - https://generalistprogrammer.com/tutorials/rust-game-development-complete-guide-2025

### Community

- **Rust Users Forum** - https://users.rust-lang.org/
- **r/rust** - https://reddit.com/r/rust
- **Rust GameDev Working Group** - https://gamedev.rs/
- **This Week in Rust** - https://this-week-in-rust.org/

---

## 🔍 Key Questions to Answer

Before committing to Rust migration:

### Technical Questions

1. **Performance**: Do benchmarks show meaningful gains (>2x) for your workloads?
2. **Bundle size**: Is 8-15MB WASM acceptable for your user base?
3. **Firebase**: Can you live with TypeScript handling all Firestore access?
4. **Rendering**: wgpu custom renderer vs Three.js upgrade?
5. **Debugging**: Can you debug effectively with current WASM tools?

### Team Questions

6. **Expertise**: Do you have Rust experience, or willing to learn?
7. **Time**: Can you afford slower iteration during learning phase?
8. **Commitment**: Is this a long-term project (2+ years)?
9. **Hiring**: Can you hire Rust developers if needed?

### Product Questions

10. **Users**: What are their network/device constraints?
11. **Features**: Does performance unlock new features?
12. **Roadmap**: Are you building a simple VTT or complex game platform?
13. **Desktop**: Do you plan desktop app (Tauri) in future?

---

## 🎬 Conclusion

### Viability: **HIGH** ✅

Rust + WASM is a viable option for Wall & Shadow, particularly for the **data layer** (geometry, collision, LoS calculations). The **graphics layer** migration to wgpu is a larger commitment and should only be pursued if the data layer succeeds and performance demands it.

### Recommended Approach: **Incremental Hybrid**

1. **Immediate**: Upgrade Three.js (per RENDER_UPGRADE_READING_LIST.md)
2. **Short-term**: Rust spike for grid geometry (1-2 weeks)
3. **Medium-term**: Migrate data layer if spike succeeds (2-3 months)
4. **Long-term**: Evaluate graphics layer migration (6-12 months)

### Key Success Factors

- **Start small**: Don't rewrite everything
- **Measure**: Benchmark performance and bundle size
- **Iterate**: Use fast feedback loops
- **Preserve optionality**: Keep TypeScript working alongside Rust
- **Team buy-in**: Ensure team is excited, not forced

### When NOT to Use Rust

- **Tight deadlines**: Stick with TypeScript
- **Team unfamiliarity**: Learning curve too steep
- **Simple requirements**: TypeScript is "fast enough"
- **Heavy DOM manipulation**: JavaScript is always better

### When TO Use Rust

- **Performance-critical**: Geometry, raycasting, physics
- **Correctness-critical**: Complex algorithms, state machines
- **Long-term project**: Amortize learning investment
- **Cross-platform future**: Desktop app planned (Tauri)

---

**Next Steps:**
1. Review RENDER_UPGRADE_READING_LIST.md
2. Upgrade Three.js to r172+ with modern patterns
3. Evaluate if issues are resolved
4. If not → Rust spike for grid geometry
5. Measure, decide, iterate

---

*Document created: 2025-12-26*
*For: Wall & Shadow Rust/WASM viability assessment*
