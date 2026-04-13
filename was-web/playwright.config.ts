import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Wall & Shadow e2e tests.
 *
 * Tests run against the Hono REST API server and the Vite dev server.
 * Each test is fully isolated (unique users via UUID emails) so tests
 * run in parallel across 50% of available CPU cores.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.test.ts',

  // Timeout settings — slightly generous to account for parallel load
  timeout: 180000, // longTestTimeout - some tests take a while
  expect: {
    timeout: 10000, // individual assertions (bumped from 8s for parallel load)
  },

  // Test execution configuration
  fullyParallel: !process.env.CI, // Parallel locally (isolated via unique users), serial in CI
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : '50%', // Serial in CI, 50% of cores locally

  // Reporter configuration
  reporter: [
    ['list'],
    ['html', {
      outputFolder: 'e2e/test-results/html',
      host: '0.0.0.0',  // Bind to all interfaces for Docker port forwarding
    }],
  ],

  // Shared settings for all tests
  use: {
    // Base URL for the React dev server
    baseURL: 'http://localhost:5000',

    // Screenshots and videos
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    // Navigation timeout (matching pageNavigationTimeout from main.test.ts:60)
    navigationTimeout: 15000,
    actionTimeout: 10000,

    // Bypass CSP to prevent interference with OIDC callback redirects.
    // React Router's client navigation interceptor tries to prefetch the callback URL,
    // which fails under strict CSP and consumes the single-use authorization code.
    bypassCSP: true,
  },

  // Browser/device projects (matching the 8 configs from main.test.ts:44-53)
  // Note: GPU flags (--use-gl=desktop, etc) are only compatible with Chromium and Firefox
  // Webkit browsers (including iPhone 7 which uses webkit as defaultBrowserType) don't support these flags
  projects: [
    // TODO: Re-enable WebKit projects when we develop a WebKit testing strategy
    // WebKit doesn't support SwANGLE flags and requires ANGLE_instanced_arrays extension
    // which may only be available in --headed mode. For now, focusing on Chromium and Firefox.
    // {
    //   name: 'chromium-iphone7',
    //   use: {
    //     ...devices['iPhone 7'],
    //     // iPhone 7 uses webkit as defaultBrowserType, so no GPU flags
    //   },
    // },
    {
      name: 'chromium-pixel2',
      use: {
        ...devices['Pixel 2'],
        launchOptions: {
          args: [
            '--use-gl=angle',          // Use ANGLE for WebGL
            '--use-angle=swiftshader-webgl', // Use SwiftShader software rendering for WebGL
            '--enable-gpu',            // Enable GPU hardware acceleration
            '--ignore-gpu-blocklist',  // Bypass GPU blocklist
            '--disable-features=SpeculationRules', // Prevent speculative prefetch consuming OAuth codes
          ],
        },
      },
    },
    {
      name: 'chromium-laptop',
      use: {
        viewport: { width: 1366, height: 768 },
        launchOptions: {
          args: [
            '--use-gl=angle',          // Use ANGLE for WebGL
            '--use-angle=swiftshader-webgl', // Use SwiftShader software rendering for WebGL
            '--enable-gpu',            // Enable GPU hardware acceleration
            '--ignore-gpu-blocklist',  // Bypass GPU blocklist
            '--disable-features=SpeculationRules', // Prevent speculative prefetch consuming OAuth codes
          ],
        },
      },
    },
    {
      name: 'chromium-desktop',
      use: {
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: [
            '--use-gl=angle',          // Use ANGLE for WebGL
            '--use-angle=swiftshader-webgl', // Use SwiftShader software rendering for WebGL
            '--enable-gpu',            // Enable GPU hardware acceleration
            '--ignore-gpu-blocklist',  // Bypass GPU blocklist
            '--disable-features=SpeculationRules', // Prevent speculative prefetch consuming OAuth codes
          ],
        },
      },
    },
    {
      name: 'firefox-laptop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1366, height: 768 },
        launchOptions: {
          args: [
            '--use-gl=angle',          // Use ANGLE for WebGL
            '--use-angle=swiftshader-webgl', // Use SwiftShader software rendering for WebGL
            '--enable-gpu',            // Enable GPU hardware acceleration
            '--ignore-gpu-blocklist',  // Bypass GPU blocklist
            '--disable-features=SpeculationRules', // Prevent speculative prefetch consuming OAuth codes
          ],
        },
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: [
            '--use-gl=angle',          // Use ANGLE for WebGL
            '--use-angle=swiftshader-webgl', // Use SwiftShader software rendering for WebGL
            '--enable-gpu',            // Enable GPU hardware acceleration
            '--ignore-gpu-blocklist',  // Bypass GPU blocklist
            '--disable-features=SpeculationRules', // Prevent speculative prefetch consuming OAuth codes
          ],
        },
      },
    },
    // {
    //   name: 'webkit-laptop',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     viewport: { width: 1366, height: 768 },
    //     // Webkit doesn't support GPU launch options
    //   },
    // },
    // {
    //   name: 'webkit-desktop',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     viewport: { width: 1920, height: 1080 },
    //     // Webkit doesn't support GPU launch options
    //   },
    // },
  ],
});
