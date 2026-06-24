var Errors = require('./errors');
var JsFile = require('./js-file');
var TokenIndex = require('./token-index');
var Configuration = require('./config/configuration');
var FixLoopState = require('./fix-loop-state');

var MAX_FIX_ATTEMPTS = 5;

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

    this._errorsFound = 0;
    this._maxErrorsExceeded = false;

    this._configuration = this._createConfiguration();
    this._configuration.registerDefaultPresets();
};

StringChecker.prototype = {
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

        var file = this._createJsFileInstance(filename, source);

        var errors = new Errors(file);

        file.getParseErrors().forEach(function(parseError) {
            if (!this._maxErrorsExceeded) {
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
     * Apply fix for common errors (error has its own fix function).
     * Uses the unified markAsFixed API to track whether code actually changed.
     *
     * @param {JsFile} file
     * @param {Error} error
     * @param {Errors} errors
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixCommonError: function(file, error, errors) {
        if (error.fix) {
            var sourceBefore = file.render();
            errors.markAsFixed(error, false);
            error.fix();
            var sourceAfter = file.render();
            var actuallyChanged = sourceBefore !== sourceAfter;
            errors.markAsFixed(error, actuallyChanged);
        }

        return !!error.fixed;
    },

    /**
     * Apply fix for specific error using the rule's public fix() method.
     * This implements the standard rule protocol: configure -> check -> fix.
     * Uses the unified markAsFixed API to track whether code actually changed.
     *
     * @param {JsFile} file
     * @param {Error} error
     * @param {Errors} errors
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixSpecificError: function(file, error, errors) {
        var configuration = this.getConfiguration();
        var instance = configuration.getConfiguredRule(error.rule);

        if (instance) {
            var fixMethod = instance.fix || instance._fix;
            if (fixMethod) {
                var sourceBefore = file.render();
                errors.markAsFixed(error, false);
                fixMethod.call(instance, file, error);
                var sourceAfter = file.render();
                var actuallyChanged = sourceBefore !== sourceAfter;
                errors.markAsFixed(error, actuallyChanged);
            }
        }

        return !!error.fixed;
    },

    /**
     * Apply specific and common fixes.
     *
     * @param {JsFile} file
     * @param {Errors} errors
     * @returns {Object} { fixedCount, actuallyChangedCount }
     * @protected
     */
    _fixJsFile: function(file, errors) {
        var fixedCount = 0;
        var actuallyChangedCount = 0;

        errors.getErrorList().forEach(function(error) {
            if (error.fixed) {
                return;
            }

            try {
                // Try to apply fixes for common errors
                var isFixed = this._fixCommonError(file, error, errors);

                // Apply specific fix
                if (!isFixed) {
                    this._fixSpecificError(file, error, errors);
                }

                if (error.fixed) {
                    fixedCount++;
                    if (errors.wasActuallyChanged(error)) {
                        actuallyChangedCount++;
                    }
                }
            } catch (e) {
                error.fixed = false;
                errors.add(
                    getInternalErrorMessage(error.rule, e),
                    file.getProgram()
                );
            }
        }, this);

        return {
            fixedCount: fixedCount,
            actuallyChangedCount: actuallyChangedCount
        };
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
        if (this._maxErrorsExceeded) {
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
                this._maxErrorsExceeded = false;

            } else {
                this._maxErrorsExceeded = this._errorsFound + errors.getErrorCount() > this._maxErrors;
                errors.stripErrorList(Math.max(0, this._maxErrors - this._errorsFound));
            }
        }

        this._errorsFound += errors.getErrorCount();
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
        if (this._maxErrorsExceeded) {
            return;
        }

        errors.add(parseError, file.getProgram());

        if (this.maxErrorsEnabled()) {
            this._errorsFound += 1;
            this._maxErrorsExceeded = this._errorsFound >= this._maxErrors;
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
     * Uses the unified fix loop state tracker to monitor progress,
     * detect fixed points and oscillations, and properly handle
     * errors that were marked fixed but didn't actually change code.
     *
     * @param {String} source
     * @param {String} [filename='input']
     * @returns {{output: String, errors: Errors, fixState: FixLoopState}}
     */
    fixString: function(source, filename) {
        filename = filename || 'input';

        var file = this._createJsFileInstance(filename, source);
        var errors = new Errors(file);
        var fixState = new FixLoopState(MAX_FIX_ATTEMPTS);

        var parseErrors = file.getParseErrors();
        if (parseErrors.length > 0) {
            parseErrors.forEach(function(parseError) {
                this._addParseError(errors, parseError, file);
            }, this);

            return {output: source, errors: errors, fixState: fixState};
        } else {
            var currentSource = source;
            var hasFixes;

            do {
                fixState.startAttempt();

                // Fill in errors list
                this._checkJsFile(file, errors);

                // Apply fixes and track what actually changed
                var sourceBefore = file.render();
                var fixStats = this._fixJsFile(file, errors);
                var sourceAfter = file.render();

                // Record this attempt in the state tracker
                fixState.recordAttempt(
                    sourceBefore,
                    sourceAfter,
                    errors,
                    fixStats.fixedCount,
                    fixStats.actuallyChangedCount
                );

                hasFixes = errors.getErrorList().some(function(err) {
                    return err.fixed;
                });

                // Stop if we reached a fixed point or detected oscillation
                if (!hasFixes || fixState.hasReachedFixedPoint() || fixState.isOscillating()) {
                    break;
                }

                currentSource = file.render();
                file = this._createJsFileInstance(filename, currentSource);
                errors = new Errors(file);
            } while (fixState.getAttemptCount() < MAX_FIX_ATTEMPTS);

            // Filter out errors that were marked fixed but didn't actually change code
            errors.filterSuppressedErrors();

            // Add any warnings from the fix loop as errors
            fixState.getWarnings().forEach(function(warning) {
                errors.add(warning, file.getProgram());
            });

            return {output: currentSource, errors: errors, fixState: fixState};
        }
    },

    /**
     * Gets the standard rule scheduler that implements the
     * configure -> check -> fix three-phase protocol.
     *
     * @returns {Object} Rule scheduler interface
     */
    getRuleScheduler: function() {
        var self = this;
        return {
            /**
             * Configure a rule with the given options.
             * Phase 1 of the standard rule protocol.
             *
             * @param {Object} rule
             * @param {*} options
             */
            configureRule: function(rule, options) {
                rule.configure(options);
            },

            /**
             * Run a rule's check phase.
             * Phase 2 of the standard rule protocol.
             *
             * @param {Object} rule
             * @param {JsFile} file
             * @param {Errors} errors
             */
            checkRule: function(rule, file, errors) {
                errors.setCurrentRule(rule.getOptionName());
                rule.check(file, errors);
            },

            /**
             * Run a rule's fix phase.
             * Phase 3 of the standard rule protocol.
             * Supports both the new public fix() method and the
             * legacy _fix() private method for backward compatibility.
             *
             * @param {Object} rule
             * @param {JsFile} file
             * @param {Object} error
             * @param {Errors} errors
             * @returns {Boolean}
             */
            fixRule: function(rule, file, error, errors) {
                var fixMethod = rule.fix || rule._fix;
                if (fixMethod) {
                    var sourceBefore = file.render();
                    errors.markAsFixed(error, false);
                    fixMethod.call(rule, file, error);
                    var sourceAfter = file.render();
                    errors.markAsFixed(error, sourceBefore !== sourceAfter);
                    return true;
                }
                return false;
            },

            /**
             * Get all configured rules.
             *
             * @returns {Object[]}
             */
            getConfiguredRules: function() {
                return self._configuredRules;
            }
        };
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
        return this._maxErrorsExceeded;
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
    }
};

module.exports = StringChecker;
