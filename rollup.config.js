const fs = require("fs");
const fsPromises = require("fs/promises");
const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const typescript = require("@rollup/plugin-typescript");
const scss = require("rollup-plugin-scss");
const copy = require("rollup-plugin-copy");
const json = require("@rollup/plugin-json");
require("dotenv").config();

const moduleVersion = process.env.MODULE_VERSION;
const githubProject = process.env.GH_PROJECT;
const githubTag = process.env.GH_TAG;
const foundryPath = process.env.FOUNDRY_VTT_PATH;
const isDev = process.env.NODE_ENV === "development";

module.exports = {
  input: "src/ts/module.ts",
  output: {
    dir: "dist/scripts",
    entryFileNames: "module.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript(),
    json(),
    scss({
      input: "src/styles/style.scss",
      output: (styles) => {
        if (!styles) return;
        fs.mkdirSync("dist", { recursive: true });
        fs.writeFileSync("dist/style.css", styles);
      },
      watch: ["src/styles/*.scss"],
    }),
    copy({
      targets: [
        { src: "src/languages", dest: "dist" },
        { src: "src/templates", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
    updateModuleManifestPlugin(),
    {
      name: "foundry-copy",
      closeBundle: async () => {
        if (!isDev || !foundryPath) return;
        try {
          await fsPromises.cp("dist", foundryPath, { recursive: true, force: true });
          console.log(`Copied to Foundry modules directory: ${foundryPath}`);
        } catch (err) {
          console.error("Failed to copy to Foundry directory:", err);
        }
      },
    },
  ],
};

// writes dist/module.json with version and release urls
function updateModuleManifestPlugin() {
  return {
    name: "update-module-manifest",
    async writeBundle() {
      const packageJson = JSON.parse(await fsPromises.readFile("./package.json", "utf-8"));
      const manifest = JSON.parse(await fsPromises.readFile("src/module.json", "utf-8"));
      manifest.version = moduleVersion || packageJson.version;

      if (githubProject) {
        const baseUrl = `https://github.com/${githubProject}/releases`;
        manifest.manifest = `${baseUrl}/latest/download/module.json`;
        if (githubTag) manifest.download = `${baseUrl}/download/${githubTag}/module.zip`;
      }

      await fsPromises.writeFile("dist/module.json", JSON.stringify(manifest, null, 4));
    },
  };
}
