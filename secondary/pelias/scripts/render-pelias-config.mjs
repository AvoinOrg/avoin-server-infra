#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const env = process.env;

function required(name) {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function requiredAbsolutePath(name) {
  const value = required(name);
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path: ${value}`);
  }
  return path.normalize(value);
}

function booleanFromEnv(name) {
  const value = required(name).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be a boolean value, got: ${env[name]}`);
}

function requiredHttpUrl(name) {
  const raw = required(name);
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error(`${name} must be a valid URL: ${raw}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https: ${raw}`);
  }

  return url;
}

function assertOutputInsideConfigDir(outputPath, configDir) {
  const relative = path.relative(configDir, outputPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `PELIAS_CONFIG_OUTPUT must point to a file inside PELIAS_CONFIG_DIR (${configDir}): ${outputPath}`,
    );
  }
}

const templatePath = requiredAbsolutePath('PELIAS_CONFIG_TEMPLATE');
const configDir = requiredAbsolutePath('PELIAS_CONFIG_DIR');
const outputPath = requiredAbsolutePath('PELIAS_CONFIG_OUTPUT');
const osmDataPath = requiredAbsolutePath('OSM_DATA_PATH');
const osmLeveldbPath = requiredAbsolutePath('OSM_LEVELDB_PATH');
const osmFilename = required('OSM_PBF_FILENAME');
const osmSourceUrl = requiredHttpUrl('OSM_PBF_URL');
const adminLookupEnabled = booleanFromEnv('OSM_ADMIN_LOOKUP_ENABLED');
const importVenues = booleanFromEnv('OSM_IMPORT_VENUES');
const removeDisusedVenues = booleanFromEnv('OSM_REMOVE_DISUSED_VENUES');

assertOutputInsideConfigDir(outputPath, configDir);

const sourceFilename = path.posix.basename(osmSourceUrl.pathname);
if (sourceFilename !== osmFilename) {
  throw new Error(
    `OSM_PBF_FILENAME (${osmFilename}) must match the OSM_PBF_URL basename (${sourceFilename}) for Pelias downloads`,
  );
}

const template = JSON.parse(await readFile(templatePath, 'utf8'));

template.imports ??= {};
template.imports.adminLookup = {
  ...(template.imports.adminLookup ?? {}),
  enabled: adminLookupEnabled,
};

template.imports.openstreetmap = {
  ...(template.imports.openstreetmap ?? {}),
  datapath: osmDataPath,
  leveldbpath: osmLeveldbPath,
  download: [
    {
      sourceURL: osmSourceUrl.toString(),
    },
  ],
  import: [
    {
      filename: osmFilename,
    },
  ],
  importVenues,
  removeDisusedVenues,
};

if (template.schema?.indexName !== template.api?.indexName) {
  throw new Error(
    `schema.indexName (${template.schema?.indexName}) must match api.indexName (${template.api?.indexName})`,
  );
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`);

console.log(`Rendered Pelias config: ${outputPath}`);
