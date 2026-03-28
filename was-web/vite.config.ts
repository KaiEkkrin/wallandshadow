import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import packageJson from './package.json';

// Get Git commit hash (first 8 characters)
const getGitCommitHash = (): string => {
  try {
    const fullHash = execSync('git rev-parse HEAD').toString().trim();
    return fullHash.substring(0, 8);
  } catch (err) {
    console.warn('Failed to get Git commit hash:', err);
    return 'unknown';
  }
};

const gitCommitHash = getGitCommitHash();
const versionString = `v${packageJson.version}+${gitCommitHash}`;

// Get deployment environment (production, test, or development)
const getDeployEnvironment = (): 'production' | 'test' | 'development' => {
  const env = process.env.VITE_DEPLOY_ENV;
  if (env === 'production' || env === 'test' || env === 'development') {
    return env;
  }
  // Default to development for local builds
  return 'development';
};

const deployEnvironment = getDeployEnvironment();

/**
 * Adds environment-specific prefix to HTML title tags
 * Matches <title>any content</title> and prepends [Dev] or [Test]
 */
const addTitlePrefix = (html: string): string => {
  if (deployEnvironment === 'production') {
    return html; // No prefix for production
  }

  const prefix = deployEnvironment === 'test' ? '[Test] ' : '[Dev] ';
  return html.replace(/<title>([^<]*)<\/title>/, `<title>${prefix}$1</title>`);
};

// Plugin to copy environment-specific robots.txt to build output
const copyRobotsTxt = () => ({
  name: 'copy-robots-txt',
  closeBundle() {
    try {
      const sourcePath = resolve(__dirname, `public/robots.${deployEnvironment}.txt`);
      const destPath = resolve(__dirname, 'build/robots.txt');

      copyFileSync(sourcePath, destPath);

      console.log(`Copied robots.${deployEnvironment}.txt to build/robots.txt`);
    } catch (err) {
      console.error('Failed to copy robots.txt:', err);
    }
  }
});

// Plugin to copy static landing page to build output with version replacement
// and environment-specific SEO configuration
const copyLandingPage = () => ({
  name: 'copy-landing-page',
  closeBundle() {
    try {
      const sourcePath = resolve(__dirname, 'landing-index.html');
      const destPath = resolve(__dirname, 'build/index.html');

      // Read the landing page HTML
      let html = readFileSync(sourcePath, 'utf-8');

      // Replace version placeholder with actual version
      html = html.replace(/v0\.0\.0/g, versionString);

      // Environment-specific SEO modifications
      if (deployEnvironment === 'test' || deployEnvironment === 'development') {
        // Add noindex, nofollow meta tag for test and development
        const noindexTag = '\n  <meta name="robots" content="noindex, nofollow">';
        html = html.replace('</head>', `${noindexTag}\n</head>`);

        // Remove canonical tag to avoid canonical + noindex conflict (2025 SEO best practice)
        html = html.replace(/<link rel="canonical"[^>]*>/g, '');

        console.log(`Added noindex meta tag and removed canonical tag for ${deployEnvironment} environment`);
      }

      // Add environment-specific title prefix
      html = addTitlePrefix(html);

      // Write to build directory
      writeFileSync(destPath, html, 'utf-8');

      console.log(`Static landing page copied to build/index.html (version: ${versionString}, env: ${deployEnvironment})`);
    } catch (err) {
      console.error('Failed to copy landing page:', err);
    }
  }
});

// Plugin to process app.html with environment-specific title prefix
const processAppHtml = () => ({
  name: 'process-app-html',
  closeBundle() {
    try {
      const appPath = resolve(__dirname, 'build/app.html');
      let html = readFileSync(appPath, 'utf-8');

      // Add environment-specific title prefix
      html = addTitlePrefix(html);

      writeFileSync(appPath, html, 'utf-8');
      console.log(`Processed app.html (env: ${deployEnvironment})`);
    } catch (err) {
      console.error('Failed to process app.html:', err);
    }
  }
});

export default defineConfig({
  plugins: [react(), copyLandingPage(), processAppHtml(), copyRobotsTxt()],
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommitHash),
  },
  server: {
    port: 5000,
    proxy: {
      // Replaces setupProxy.js - proxy Firebase reserved URLs to emulator
      '/__': {
        target: 'http://localhost:3400',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
});
