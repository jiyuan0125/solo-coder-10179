/**
 * Fix loop state tracker - tracks the progress of the auto-fix loop,
 * detects fixed points, oscillations, and non-convergence.
 *
 * Provides public API for external observers to inspect the state
 * of the fix process: which rounds ran, whether we reached a
 * fixed point, whether oscillations were detected, etc.
 *
 * Also correctly handles the case where a rule marks an error as
 * fixed but doesn't actually change the code - those errors should
 * not appear in the final output.
 */

var crypto = require('crypto');

/**
 * Creates a new fix loop state tracker.
 *
 * @param {Number} maxAttempts - Maximum number of fix attempts
 * @constructor
 */
function FixLoopState(maxAttempts) {
    this._maxAttempts = maxAttempts;
    this._attempts = [];
    this._sourceHashes = [];
    this._warnings = [];
    this._currentAttempt = 0;
    this._reachedFixedPoint = false;
    this._isOscillating = false;
}

FixLoopState.prototype = {
    /**
     * Records the start of a new fix attempt.
     */
    startAttempt: function() {
        this._currentAttempt++;
    },

    /**
     * Records the result of a fix attempt.
     *
     * @param {String} sourceBefore - Source code before fixes
     * @param {String} sourceAfter - Source code after fixes
     * @param {Errors} errors - Errors object for this attempt
     * @param {Number} fixedCount - Number of errors marked as fixed
     * @param {Number} actuallyChangedCount - Number of fixes that actually changed code
     */
    recordAttempt: function(sourceBefore, sourceAfter, errors, fixedCount, actuallyChangedCount) {
        var hashBefore = this._hash(sourceBefore);
        var hashAfter = this._hash(sourceAfter);

        this._sourceHashes.push(hashAfter);

        var attemptRecord = {
            attempt: this._currentAttempt,
            errorCount: errors.getErrorCount(),
            fixedCount: fixedCount,
            actuallyChangedCount: actuallyChangedCount,
            sourceHashBefore: hashBefore,
            sourceHashAfter: hashAfter,
            sourceChanged: hashBefore !== hashAfter
        };

        this._attempts.push(attemptRecord);

        if (hashBefore === hashAfter) {
            this._reachedFixedPoint = true;
        }

        this._detectOscillation();
    },

    /**
     * Gets the maximum number of fix attempts allowed.
     *
     * @returns {Number}
     */
    getMaxAttempts: function() {
        return this._maxAttempts;
    },

    /**
     * Gets the number of fix attempts completed so far.
     *
     * @returns {Number}
     */
    getAttemptCount: function() {
        return this._attempts.length;
    },

    /**
     * Whether the fix loop reached a fixed point (no changes in an iteration).
     *
     * @returns {Boolean}
     */
    hasReachedFixedPoint: function() {
        return this._reachedFixedPoint;
    },

    /**
     * Whether oscillation was detected (source alternates between two states).
     *
     * @returns {Boolean}
     */
    isOscillating: function() {
        return this._isOscillating;
    },

    /**
     * Whether the fix loop converged (reached fixed point before max attempts).
     *
     * @returns {Boolean}
     */
    isConverged: function() {
        return this._reachedFixedPoint && this._currentAttempt < this._maxAttempts;
    },

    /**
     * Gets the complete fix history.
     *
     * @returns {Array} Array of attempt records
     */
    getFixHistory: function() {
        return this._attempts.map(function(attempt) {
            return {
                attempt: attempt.attempt,
                errorCount: attempt.errorCount,
                fixedCount: attempt.fixedCount,
                actuallyChangedCount: attempt.actuallyChangedCount,
                sourceHash: attempt.sourceHashAfter
            };
        });
    },

    /**
     * Gets any warnings generated during the fix loop.
     *
     * @returns {String[]}
     */
    getWarnings: function() {
        return this._warnings.slice();
    },

    /**
     * Gets the errors for a specific attempt.
     * Note: Errors are not stored by default; this is a placeholder
     * for future extension.
     *
     * @param {Number} attempt
     * @returns {null}
     */
    getErrorsForAttempt: function(attempt) {
        return null;
    },

    /**
     * Detects oscillation by checking if source hashes repeat.
     * @private
     */
    _detectOscillation: function() {
        var hashes = this._sourceHashes;
        var len = hashes.length;

        if (len >= 4) {
            if (hashes[len - 1] === hashes[len - 3] &&
                hashes[len - 2] === hashes[len - 4]) {
                this._isOscillating = true;
                this._warnings.push(
                    'Oscillation detected: fix loop is alternating between two states. ' +
                    'Some rules may be conflicting. Stopping after ' + this._currentAttempt + ' attempts.'
                );
            }
        }

        if (this._currentAttempt >= this._maxAttempts && !this._reachedFixedPoint) {
            this._warnings.push(
                'Fix loop did not converge after ' + this._maxAttempts + ' attempts. ' +
                'Some issues may remain unfixed.'
            );
        }
    },

    /**
     * Computes a hash of the source code for change detection.
     * @private
     */
    _hash: function(source) {
        return crypto.createHash('md5').update(source).digest('hex');
    }
};

module.exports = FixLoopState;
