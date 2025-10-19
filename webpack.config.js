const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
let terserLib = null;
try { terserLib = require('terser'); } catch (_) { /* optional */ }

// Lightweight HTML minifier to avoid adding extra deps
function minifyHtml(html) {
    if (!html || typeof html !== 'string') return html;
    // Remove HTML comments
    let out = html.replace(/<!--([\s\S]*?)-->/g, '');
    // Collapse whitespace between tags
    out = out.replace(/>\s+</g, '><');
    // Trim leading/trailing whitespace
    out = out.trim();
    return out;
}

async function minifyJs(contentBuffer) {
    try {
        if (!terserLib) return contentBuffer;
        const input = contentBuffer.toString();
        const result = await terserLib.minify(input, {
            compress: { passes: 2 },
            mangle: true,
            format: { comments: false }
        });
        if (result && result.code) {
            return Buffer.from(result.code, 'utf8');
        }
    } catch (_) { /* noop */ }
    return contentBuffer;
}

module.exports = {
    mode: 'production',
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: true, // Remove console.logs
                        drop_debugger: true,
                        pure_funcs: ['console.log', 'console.info'] // Remove specific console methods
                    },
                    mangle: true,
                    output: {
                        comments: false // Remove comments
                    }
                },
                extractComments: false
            })
        ],
        usedExports: true, // Tree shaking
        sideEffects: false
    },
    entry: './src/app.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '/'
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        port: 8080,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true
            },
            '/ws': {
                target: 'http://localhost:3000',
                ws: true,
                changeOrigin: true
            }
        },
        hot: true
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: 'src/index.html',
                    to: 'index.html',
                    transform(content) {
                        try {
                            return Buffer.from(minifyHtml(content.toString()), 'utf8');
                        } catch (_) {
                            // Fallback to original content if minification fails
                            return content;
                        }
                    }
                },
                { from: 'src/styles.css', to: 'styles.css' },
                // Chat mode removed; no chat.js or chat.css copied
            ]
        })
    ]
};
