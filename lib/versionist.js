/*
 * Copyright 2016 Resin.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/**
 * @module Versionist
 */

const _ = require('lodash');
const childProcess = require('child_process');
const gitLog = require('./git-log');
const template = require('./template');
const semver = require('./semver');

/**
 * @summary Read history from a git directory
 * @function
 * @public
 *
 * @description
 * This function is a facade around all the other
 * helper functions created in this module, and its
 * the only one the client should call.
 *
 * @param {String} gitDirectory - path to `.git` directory
 * @param {Object} [options={}] - options
 * @param {String} [options.startReference] - start reference
 * @param {String} [options.endReference] - end reference
 * @param {Function} [options.subjectParser] - subject parser hook
 * @param {Function} [options.bodyParser] - body parser hook
 * @param {Boolean} [options.includeMergeCommits=false] - include merge commits
 * @param {Function} callback - callback (error, commits)
 *
 * @example
 * versionist.readCommitHistory('path/to/.git', {
 *   startReference: 'v1.0.0',
 *   endReference: 'v1.1.0',
 *   subjectParser: (subject) => {
 *     return subject.toUpperCase();
 *   },
 *   bodyParser: (body) => {
 *     return body.split('\n');
 *   }
 * }, (error, commits) => {
 *   if (error) {
 *     throw error;
 *   }
 *
 *   console.log(commits);
 * });
 */
exports.readCommitHistory = (gitDirectory, options = {}, callback) => {

  if (!gitDirectory) {
    throw new Error('Missing gitDirectory');
  }

  const command = gitLog.getGitLogCommandArgumentsThatOutputYaml({
    gitDirectory: gitDirectory,
    startReference: options.startReference,
    endReference: options.endReference,
    includeMergeCommits: options.includeMergeCommits
  });

  const child = childProcess.spawn('git', command);
  let stdout = '';

  child.stdout.on('data', (data) => {
    stdout += data;
  });

  child.stderr.on('data', (data) => {
    child.kill();
    return callback(new Error(data));
  });

  child.on('error', (error) => {
    child.kill();
    return callback(error);
  });

  child.on('close', (code) => {
    if (code !== 0) {
      return callback(new Error(`Child process exitted with error code: ${code}`));
    }

    const parsedCommits = gitLog.parseGitLogYAMLOutput(stdout, {
      subjectParser: options.subjectParser,
      bodyParser: options.bodyParser
    });

    return callback(null, parsedCommits);
  });
};

/**
 * @summary Calculate next Semver version from a list of commits
 * @function
 * @public
 *
 * @param {Object[]} commits - commits
 * @param {Object} options - options
 * @param {String} options.currentVersion - current semver version
 * @param {Function} options.getIncrementLevelFromCommit - get increment level from commit
 * @returns {String} next version
 *
 * @example
 * const nextVersion = versionist.calculateNextVersion([
 *   {
 *     subject: 'foo bar',
 *     ...
 *   },
 *   ...
 * ], {
 *   currentVersion: '1.1.0',
 *   getIncrementLevelFromCommit: (commit) => {
 *     // Return a valid increment level from the commit
 *   }
 * });
 */
exports.calculateNextVersion = (commits, options = {}) => {

  if (!options.currentVersion) {
    throw new Error('Missing the currentVersion option');
  }

  if (!options.getIncrementLevelFromCommit) {
    throw new Error('Missing the getIncrementLevelFromCommit option');
  }

  if (!_.isFunction(options.getIncrementLevelFromCommit)) {
    throw new Error(`Invalid getIncrementLevelFromCommit option: ${options.getIncrementLevelFromCommit}`);
  }

  const incrementLevel = semver.calculateNextIncrementLevel(commits, {
    getIncrementLevelFromCommit: options.getIncrementLevelFromCommit
  });

  if (!incrementLevel) {
    return options.currentVersion;
  }

  return semver.incrementVersion(options.currentVersion, incrementLevel);
};

/**
 * @summary Generate CHANGELOG from commits
 * @function
 * @public
 *
 * @param {Object[]} commits - commits
 * @param {Object} options - options
 * @param {String} options.version - current semver version
 * @param {Function} [options.includeCommitWhen] - include commit filter predicate
 * @param {Date} [options.date=new Date()] - date object
 * @returns {String} CHANGELOG
 *
 * @example
 * const CHANGELOG = versionist.generateChangelog([
 *   {
 *     subject: 'foo bar',
 *     ...
 *   },
 *   ...
 * ], {
 *   version: '1.1.0',
 *   template: [
 *     '{{#each commits}}',
 *     '{{this.subject}}',
 *     '{{/each}}'
 *   ].join('\n')
 * });
 */
exports.generateChangelog = (commits, options = {}) => {

  if (_.isEmpty(commits)) {
    throw new Error('No commits to generate the CHANGELOG from');
  }

  if (!options.template) {
    throw new Error('Missing the template option');
  }

  if (!options.version) {
    throw new Error('Missing the version option');
  }

  _.defaults(options, {
    date: new Date(),
    includeCommitWhen: _.constant(true)
  });

  if (!(options.date instanceof Date)) {
    throw new Error(`Invalid date option: ${options.date}`);
  }

  return template.render(options.template, {
    commits: _.filter(commits, options.includeCommitWhen),
    version: semver.normalize(options.version),
    date: options.date
  });
};
