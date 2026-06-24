var assert = require('assert');
var Errors = require('./errors');
var JsFile = require('./js-file');
var TokenIndex = require('./token-index');
var Configuration = require('./config/configuration');

var MAX_FIX_ATTEMPTS = 5;

// Reporter contract marker.
// Reporters that want to receive the standardized reportContext object
// (instead of the legacy raw errorsCollection array) should either:
//   a) export an object with a `write` method, OR
//   b) attach this Symbol as a truthy property on the function:
//        reporter[StringChecker.REPORTER_CONTRACT] = true;
var REPORTER_CONTRACT = typeof Symbol !== 'undefined' ?
    Symbol('jscs-reporter-contract-v1') :
    '__jscsReporterContractV1__';

function getInternalErrorMessage(rule, e) {
    return 'Error running rule ' + rule + ': ' +
        'This is an issue with JSCS and not your codebase.\n' +
        'Please file an issue (with the stack trace below) at: ' +
        'https://github.com/jscs-dev/node-jscs/issues/new\n' + e.stack;
}

/**
 * Starts Code Style checking process.
 *
 * @name StringChecker
 */
var StringChecker = function() {
    this._configuredRules = [];

    this._runState = null;

    this._reporters = {};

    this._configuration = this._createConfiguration();
    this._configuration.registerDefaultPresets();
};

StringChecker.prototype = {
    _initRunState: function() {
        this._runState = {
            errorsFound: 0,
            maxErrorsExceeded: false
        };
    },

    /**
     * Registers single Code Style checking rule.
     *
     * @param {Rule} rule
     */
    registerRule: function(rule) {
        this._configuration.registerRule(rule);
    },

    /**
     * Registers built-in Code Style checking rules.
     */
    registerDefaultRules: function() {
        this._configuration.registerDefaultRules();
    },

    /**
     * Get processed config.
     *
     * @return {Object}
     */
    getProcessedConfig: function() {
        return this._configuration.getProcessedConfig();
    },

    /**
     * Loads configuration from JS Object. Activates and configures required rules.
     *
     * @param {Object} config
     */
    configure: function(config) {
        this._configuration.load(config);

        this._configuredRules = this._configuration.getConfiguredRules();
        this._maxErrors = this._configuration.getMaxErrors();

        this._initRunState();
    },

    /**
     * Checks file provided with a string.
     *
     * @param {String} source
     * @param {String} [filename='input']
     * @returns {Errors}
     */
    checkString: function(source, filename) {
        filename = filename || 'input';
        this._initRunState();

        var file = this._createJsFileInstance(filename, source);

        var errors = new Errors(file);

        file.getParseErrors().forEach(function(parseError) {
            if (!this._runState.maxErrorsExceeded) {
                this._addParseError(errors, parseError, file);
            }
        }, this);

        if (file.isEmpty()) {
            return errors;
        }

        this._checkJsFile(file, errors);

        return errors;
    },

    /**
     * Apply fix for common errors.
     *
     * @param {Error} error
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixCommonError: function(error) {
        if (error.fix) {
            // "error.fixed = true" should go first, so rule can
            // decide for itself (with "error.fixed = false")
            // if it can fix this particular error
            error.fixed = true;
            error.fix();
        }

        return !!error.fixed;
    },

    /**
     * Apply fix for specific error.
     *
     * @param {JsFile} file
     * @param {Error} error
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixSpecificError: function(file, error) {
        var configuration = this.getConfiguration();
        var instance = configuration.getConfiguredRule(error.rule);

        if (instance && instance._fix) {
            // "error.fixed = true" should go first, so rule can
            // decide for itself (with "error.fixed = false")
            // if it can fix this particular error
            error.fixed = true;
            instance._fix(file, error);
        }

        return !!error.fixed;
    },

    /**
     * Apply specific and common fixes.
     *
     * @param {JsFile} file
     * @param {Errors} errors
     * @protected
     */
    _fixJsFile: function(file, errors) {
        errors.getErrorList().forEach(function(error) {
            if (error.fixed) {
                return;
            }

            try {
                // Try to apply fixes for common errors
                var isFixed = this._fixCommonError(error);

                // Apply specific fix
                if (!isFixed) {
                    this._fixSpecificError(file, error);
                }
            } catch (e) {
                error.fixed = false;
                errors.add(
                    getInternalErrorMessage(error.rule, e),
                    file.getProgram()
                );
            }
        }, this);
    },

    /**
     * Checks a file specified using JsFile instance.
     * Fills Errors instance with validation errors.
     *
     * @param {JsFile} file
     * @param {Errors} errors
     * @protected
     */
    _checkJsFile: function(file, errors) {
        if (this._runState.maxErrorsExceeded) {
            return;
        }

        var errorFilter = this._configuration.getErrorFilter();

        this._configuredRules.forEach(function(rule) {
            errors.setCurrentRule(rule.getOptionName());

            try {
                rule.check(file, errors);
            } catch (e) {
                errors.setCurrentRule('internalError');
                errors.add(getInternalErrorMessage(rule.getOptionName(), e), file.getProgram());
            }
        }, this);

        this._configuration.getUnsupportedRuleNames().forEach(function(rulename) {
            errors.add('Unsupported rule: ' + rulename, file.getProgram());
        });

        var program = file.getProgram();
        var tokenIndex = new TokenIndex(program.getFirstToken());
        errors.calculateErrorLocations(tokenIndex);
        errors.filter(function(error) {
            if (error.element) {
                return tokenIndex.isRuleEnabled(error.rule, error.element);
            } else {
                return true;
            }
        });

        // sort errors list to show errors as they appear in source
        errors.getErrorList().sort(function(a, b) {
            return (a.line - b.line) || (a.column - b.column);
        });

        if (errorFilter) {
            errors.filter(errorFilter);
        }

        if (this.maxErrorsEnabled()) {
            if (this._maxErrors === -1 || this._maxErrors === null) {
                this._runState.maxErrorsExceeded = false;

            } else {
                var totalErrors = this._runState.errorsFound + errors.getErrorCount();
                this._runState.maxErrorsExceeded = totalErrors > this._maxErrors;
                errors.stripErrorList(
                    Math.max(0, this._maxErrors - this._runState.errorsFound)
                );
            }
        }

        this._runState.errorsFound += errors.getErrorCount();
    },

    /**
     * Adds parse error to the error list.
     *
     * @param {Errors} errors
     * @param {Error} parseError
     * @param {JsFile} file
     * @private
     */
    _addParseError: function(errors, parseError, file) {
        if (this._runState.maxErrorsExceeded) {
            return;
        }

        errors.add(parseError, file.getProgram());

        if (this.maxErrorsEnabled()) {
            this._runState.errorsFound += 1;
            this._runState.maxErrorsExceeded = this._runState.errorsFound >= this._maxErrors;
        }
    },

    /**
     * Creates configured JsFile instance.
     *
     * @param {String} filename
     * @param {String} source
     * @private
     */
    _createJsFileInstance: function(filename, source) {
        return new JsFile({
            filename: filename,
            source: source,
            es3: this._configuration.isES3Enabled()
        });
    },

    /**
     * Checks and fix file provided with a string.
     *
     * @param {String} source
     * @param {String} [filename='input']
     * @returns {{output: String, errors: Errors}}
     */
    fixString: function(source, filename) {
        filename = filename || 'input';
        this._initRunState();

        var file = this._createJsFileInstance(filename, source);
        var errors = new Errors(file);

        var parseErrors = file.getParseErrors();
        if (parseErrors.length > 0) {
            parseErrors.forEach(function(parseError) {
                this._addParseError(errors, parseError, file);
            }, this);

            return {output: source, errors: errors};
        } else {
            var attempt = 0;
            do {

                // Fill in errors list
                this._checkJsFile(file, errors);

                // Apply fixes
                this._fixJsFile(file, errors);

                var hasFixes = errors.getErrorList().some(function(err) {
                    return err.fixed;
                });

                if (!hasFixes) {
                    break;
                }

                file = this._createJsFileInstance(filename, file.render());
                errors = new Errors(file);
                attempt++;
            } while (attempt < MAX_FIX_ATTEMPTS);

            return {output: file.getSource(), errors: errors};
        }
    },

    /**
     * Returns `true` if max erros limit is enabled.
     *
     * @returns {Boolean}
     */
    maxErrorsEnabled: function() {
        return this._maxErrors !== null && this._maxErrors !== -1;
    },

    /**
     * Returns `true` if error count exceeded `maxErrors` option value.
     *
     * @returns {Boolean}
     */
    maxErrorsExceeded: function() {
        return this._runState ? this._runState.maxErrorsExceeded : false;
    },

    /**
     * Returns new configuration instance.
     *
     * @protected
     * @returns {Configuration}
     */
    _createConfiguration: function() {
        return new Configuration();
    },

    /**
     * Returns current configuration instance.
     *
     * @returns {Configuration}
     */
    getConfiguration: function() {
        return this._configuration;
    },

    /**
     * Registers a reporter under the given name.
     *
     * Reporter Contract:
     * A reporter MUST be one of:
     *   1. A Function with signature: `function(reportContext)`
     *   2. An object with a `write` method: `{ write: function(reportContext) }`
     *
     * ReportContext (standardized input):
     *   {
     *     errorsCollection: Errors[],   // Array of Errors instances (one per file)
     *     getTotalErrorCount: Function, // Returns total number of errors across all files
     *     getFileCount: Function,       // Returns number of files with errors
     *     getAllErrors: Function,       // Returns flat array of all error objects
     *     getFilename: Function         // Returns filename for a given Errors instance
     *   }
     *
     * For backward compatibility, a reporter function with arity !== 1 will
     * receive the raw errorsCollection array as its only argument (legacy mode).
     *
     * @param {String} name
     * @param {Function|Object} reporter
     */
    registerReporter: function(name, reporter) {
        assert(
            typeof name === 'string' && name.length > 0,
            'Reporter name must be a non-empty string'
        );
        assert(
            typeof reporter === 'function' ||
            (typeof reporter === 'object' && reporter !== null && typeof reporter.write === 'function'),
            'Reporter must be a function or an object with a write() method'
        );
        assert(
            !this._reporters.hasOwnProperty(name),
            'Reporter "' + name + '" is already registered'
        );
        this._reporters[name] = reporter;
    },

    /**
     * Returns the registered reporter with the given name, or undefined.
     *
     * @param {String} name
     * @returns {Function|Object|undefined}
     */
    getReporter: function(name) {
        return this._reporters[name];
    },

    /**
     * Returns the names of all registered reporters.
     *
     * @returns {String[]}
     */
    getRegisteredReporters: function() {
        return Object.keys(this._reporters);
    },

    /**
     * Creates a standardized report context for reporters.
     *
     * @param {Errors[]} errorsCollection
     * @returns {Object} reportContext
     */
    createReportContext: function(errorsCollection) {
        assert(
            Array.isArray(errorsCollection),
            'errorsCollection must be an array of Errors instances'
        );

        return {
            errorsCollection: errorsCollection,

            getTotalErrorCount: function() {
                return errorsCollection.reduce(function(total, errors) {
                    return total + errors.getErrorCount();
                }, 0);
            },

            getFileCount: function() {
                return errorsCollection.filter(function(errors) {
                    return !errors.isEmpty();
                }).length;
            },

            getAllErrors: function() {
                var allErrors = [];
                errorsCollection.forEach(function(errors) {
                    allErrors = allErrors.concat(errors.getErrorList());
                });
                return allErrors;
            },

            getFilename: function(errors) {
                return errors.getFilename();
            },

            explainError: function(errors, error) {
                return errors.explainError(error);
            }
        };
    },

    /**
     * Runs a registered reporter against the given errors collection.
     *
     * Reporter dispatch rules:
     *   - Object form (`{ write: fn }`): always new contract, receives reportContext
     *   - Function form with `reporter[StringChecker.REPORTER_CONTRACT]` truthy:
     *     new contract, receives reportContext
     *   - Plain function (no marker): LEGACY mode, receives raw errorsCollection
     *
     * No arity inference is used — arity 1 is common to both legacy and
     * new-contract reporters and cannot reliably distinguish them.
     *
     * @param {String} name
     * @param {Errors[]} errorsCollection
     * @returns {*} The return value of the reporter, if any
     */
    runReporter: function(name, errorsCollection) {
        var reporter = this._reporters[name];
        assert(reporter !== undefined, 'Reporter "' + name + '" is not registered');

        var isObjectReporter = typeof reporter === 'object' && reporter !== null;
        var optsIn = isObjectReporter || reporter[REPORTER_CONTRACT];

        if (optsIn) {
            var context = this.createReportContext(errorsCollection);
            return isObjectReporter ? reporter.write(context) : reporter(context);
        } else {
            // Legacy plain-function reporter: pass raw errorsCollection
            return reporter(errorsCollection);
        }
    }
};

/**
 * Marker for new-contract reporters.
 * Attach as a truthy property on a reporter function to opt in to the
 * standardized reportContext object:
 *
 *   function myReporter(ctx) { ... }
 *   myReporter[StringChecker.REPORTER_CONTRACT] = true;
 *
 * Object reporters ({ write: fn }) are automatically treated as new-contract
 * and do not need this marker.
 */
StringChecker.REPORTER_CONTRACT = REPORTER_CONTRACT;

module.exports = StringChecker;
