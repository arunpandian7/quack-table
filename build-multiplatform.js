#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGETS = [
    { platform: 'win32', arch: 'x64' },
    { platform: 'linux', arch: 'x64' },
    { platform: 'linux', arch: 'arm64' },
    { platform: 'darwin', arch: 'x64' },
    { platform: 'darwin', arch: 'arm64' },
];

async function buildForPlatform(platform, arch) {
    const target = `${platform}-${arch}`;
    
    console.log(`\n📦 Building for ${target}...`);

    // Package the extension
    console.log(`  📦 Packaging extension...`);
    execSync(`npx vsce package --target ${target} --out ./dist`, { 
        stdio: 'inherit',
        cwd: __dirname 
    });

    console.log(`  ✅ ${target} complete!`);
}

async function main() {
    // Clear previous builds
    console.log('🧹 Cleaning previous builds...');
    if (fs.existsSync('./dist')) {
        fs.rmSync('./dist', { recursive: true });
    }
    fs.mkdirSync('./dist', { recursive: true });

    // Build for each target
    for (const { platform, arch } of TARGETS) {
        try {
            await buildForPlatform(platform, arch);
        } catch (error) {
            console.error(`❌ Failed to build ${platform}-${arch}:`, error.message);
            process.exit(1);
        }
    }

    console.log('\n✨ All builds complete!');
    console.log('📦 Packages are in ./dist/');
}

main().catch(err => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
