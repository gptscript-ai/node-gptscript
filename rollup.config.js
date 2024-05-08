import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default [{
    input: 'dist/gptscript.js',
    output: {
        name: "GPTScript",
        file: "dist/gptscript.browser.js",
        format: 'iife',
        sourcemap: true,
    },
    external: [
        'net', 'http', 'path', 'child_process', 'sse.js',
    ],
    plugins: [
        typescript(),
        commonjs(),
        resolve({preferBuiltins: true}),
    ],
}];
