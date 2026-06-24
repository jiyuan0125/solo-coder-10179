/**
 * Command line config helpers
 */

var fs = require('fs');
var path = require('path');

var stripJSONComments = require('strip-json-comments');
var yaml = require('js-yaml');
var parseJson = require('jsonlint').parse;
var supportsColor = require('chalk').supportsColor;
var glob = require('glob');
var resolve = require('resolve');
var stripBOM = require('strip-bom');

// Configuration sources in priority order.
var configs = ['package.json', '.jscsrc', '.jscs.json', '.jscs.yaml'];

var builtinReporters = {
    'console': true,
    'text': true,
    'json': true,
    'junit': true,
    'checkstyle': true,
    'inline': true,
    'inlinesingle': true,
    'unix': true,
    'summary': true
};

var reporterRegistry = {};

function registerReporter(name, reporter) {
    reporterRegistry[name] = reporter;
}

function getRegisteredReporter(name) {
    return reporterRegistry[name] || null;
}

function isBuiltinReporter(name) {
    return !!builtinReporters[name];
}

// Before, "findup-sync" package was used,
// but it does not provide filter callback
function findup(patterns, options, fn) {
    /* jshint -W083 */

    var lastpath;
    var file;

    options = Object.create(options);
    options.maxDepth = 1;
    options.cwd = path.resolve(options.cwd);

    do {
        file = patterns.filter(function(pattern) {
            var configPath = glob.sync(pattern, options)[0];

            if (configPath) {
                return fn(path.join(options.cwd, configPath));
            }
        })[0];

        if (file) {
            return path.join(options.cwd, file);
        }

        lastpath = options.cwd;
        options.cwd = path.resolve(options.cwd, '..');
    } while (options.cwd !== lastpath);
}

/**
 * Get content of the configuration file.
 *
 * @param {String} config - partial path to configuration file
 * @param {String} directory - directory path which will be joined with config argument
 * @return {Object}
 */
exports.getContent = function(config, directory) {
    if (!config) {
        return;
    }

    if (!directory) {
        directory = process.cwd();
    }

    var configPath = path.resolve(directory, config);
    var ext;
    var data;
    var content;
    var requireConfigPath;

    if (fs.existsSync(configPath)) {
        config = path.basename(config);
        ext = path.extname(configPath);

        if (ext === '.js') {
            content = require(configPath);
        } else {
            data = stripBOM(fs.readFileSync(configPath, 'utf8'));

            if (ext === '.json') {
                content = parseJson(stripJSONComments(data));
            } else if (ext === '.yaml') {
                content = yaml.safeLoad(data);
            } else {
                // try both JSON and YAML

                try {
                    content = parseJson(stripJSONComments(data));
                } catch (jsonError) {
                    try {
                        content = yaml.safeLoad(data);
                    } catch (yamlError) {
                        if (stripJSONComments(data).trim()[0] === '{') {
                            // the intention was probably JSON
                            throw jsonError;
                        } else {
                            // assume the intention was YAML
                            throw yamlError;
                        }
                    }
                }
            }
        }
    } else {
        // Try to load it as a node module
        try {
            requireConfigPath = resolve.sync(config, { basedir: directory });
            content = require(requireConfigPath);
        } catch (e) {}
    }

    if (content) {
        // Adding property via Object.defineProperty makes it
        // non-enumerable and avoids warning for unsupported rules
        Object.defineProperty(content, 'configPath', {
            value: requireConfigPath || configPath
        });
    }

    return content && config === 'package.json' ? content.jscsConfig : content;
};

/**
 * Get content of the configuration file.
 *
 * @param {String} config - partial path to configuration file
 * @param {String} [cwd = process.cwd()] - directory path which will be joined with config argument
 * @return {Object|undefined}
 */
exports.load = function(config, cwd) {
    var content;
    var directory = cwd || process.cwd();

    // If config option is given, attempt to load it
    if (config) {
        return this.getContent(config, directory);
    }

    content = this.getContent(
        findup(configs, { nocase: true, cwd: directory }, function(configPath) {
            if (path.basename(configPath) === 'package.json') {
                return !!this.getContent(configPath);
            }

            return true;
        }.bind(this))
    );

    if (content) {
        return content;
    }

    // Try to load standard configs from home dir
    var directoryArr = [process.env.USERPROFILE, process.env.HOMEPATH, process.env.HOME];
    for (var i = 0, dirLen = directoryArr.length; i < dirLen; i++) {
        if (!directoryArr[i]) {
            continue;
        }

        for (var j = 0, len = configs.length; j < len; j++) {
            content = this.getContent(configs[j], directoryArr[i]);

            if (content) {
                return content;
            }
        }
    }
};

/**
 * Register a custom reporter.
 *
 * @param {String} name - name of the reporter
 * @param {Function|Object} reporter - reporter function or module
 */
exports.registerReporter = registerReporter;

/**
 * Get a registered reporter by name.
 *
 * @param {String} name - name of the reporter
 * @return {Function|Object|null}
 */
exports.getRegisteredReporter = getRegisteredReporter;

/**
 * Check if a reporter name is a builtin reporter.
 *
 * @param {String} name - name of the reporter
 * @return {Boolean}
 */
exports.isBuiltinReporter = isBuiltinReporter;

/**
 * Load reporter.
 *
 * @param {String} reporter - name of reporter, its path or reporter module itself.
 * @param {Boolean} [colors = true] - should it be a colorful output?
 * @return {{writer: Function, path: String}}
 */
exports.getReporter = function(reporter, colors) {
    var writerPath;
    var writer;

    if (colors !== false) {
        colors = true;
    }

    if (reporter) {
        reporter = reporter.toString();

        var registered = getRegisteredReporter(reporter);
        if (registered) {
            return {
                path: 'registered:' + reporter,
                writer: registered
            };
        }

        writerPath = path.resolve(process.cwd(), reporter);

        if (!fs.existsSync(writerPath)) {
            writerPath = path.resolve(__dirname, './reporters/' + reporter);
        }
    } else {
        writerPath = path.resolve(
            __dirname, './reporters/', (colors && supportsColor ? 'console' : 'text')
        );
    }

    try {
        writer = require(writerPath);
    } catch (e) {
        writer = null;
    }

    if (!writer) {
        try {
            writer = require(reporter);
            writerPath = reporter;
        } catch (e) {}
    }

    return {
        path: writerPath,
        writer: writer
    };
};
