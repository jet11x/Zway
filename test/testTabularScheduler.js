var assert = require('assert');
const leftPad = require('left-pad');
var _ = require('underscore-node');

// Mocha tests using node assert
describe('TabularScheduler', function() {

    console.log("Outer setup");

    // returns from start->end as HH:mm->HHmm
    var readableTimes = function(actualStartDate, actualEndDate) {
        return leftPad(actualStartDate.getHours(),2,'0') + ":" + leftPad(actualStartDate.getMinutes(),2,'0') + "->" +
               leftPad(actualEndDate.getHours(),2,'0') + ":" + leftPad(actualEndDate.getMinutes(),2,'0');
    }

    var executeFile = require('../modules/executeFile');

    this.debugPrint = function(str) {
        console.log(str);
    }

    executeFile('automation/Utils.js', this);

    this._ = _;

    executeFile('test/AutomationControllerMock.js', this);
    executeFile('test/BaseModuleMock.js', this);
    executeFile('TabularScheduler/index.js', this);

    var controller = new this.AutomationController();

    var baseNow = new Date(2017, 9, 8, 9, 1); // Sunday, BST
    var now = new Date(baseNow.getTime());
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    function getHRDateformat(now) {
        var ts = now.getFullYear() + "-";
        ts += ("0" + (now.getMonth() + 1)).slice(-2) + "-";
        ts += ("0" + now.getDate()).slice(-2) + " ";
        ts += ("0" + now.getHours()).slice(-2) + ":";
        ts += ("0" + now.getMinutes()).slice(-2);
        ts += " " + days[now.getDay()];

        return ts;
    };
    this.TabularScheduler.prototype.now = function() {
        //return new Date(this.nowDate.getTime());
        return new Date(now.getTime());
    };
    this.TabularScheduler.prototype.log = function(message) {
        self = this;
        console.log(getHRDateformat(self.now()) + " " + message);
    };

    function resetNow() {
        now = new Date(baseNow.getTime());
        console.log(getHRDateformat(now) + " time changed");
    }

    function changeNow(daysForward, hours, minutes) {
        now.setHours(hours, minutes);
        now.setHours(now.getHours() + 24*daysForward);
        console.log(getHRDateformat(now) + " time changed");
    }

    var ts = new this.TabularScheduler(1, controller);

    var dev1 = "ZWayVDev_zway_15-0-37";
    var vDev1 = controller.add(dev1, "Dev1");
    var dev2 = "ZWayVDev_zway_1-0-1";
    var vDev2 = controller.add(dev2, "Dev2");
    var scen1 = "Dev-scene-start";
    var vDevS1 = controller.add(scen1, "St1");
    var scen2 = "Dev-scene-end";
    var vDevE1 = controller.add(scen2, "En2");
    var baseConfig = function () {
        return {
            "timetable": [{
                    "presence": "any",
                    "randomise": "no",
                    "days": "All",
                    "startType": "time",
                    "startTime": "19:01",
                    "endType": "time",
                    "endTime": "03:00"
                },
                {
                    "presence": "any",
                    "randomise": "yes",
                    "days": "All",
                    "startType": "time",
                    "startTime": "06:00",
                    "endType": "time",
                    "endTime": "07:00"
                }
            ],
            "startRand": {
            },
            "endRand": {
            },
            "switches": [
                {
                    "filter": "switchBinary",
                    "switchBinary": {
                        "device": dev1
                    }
                },
                {
                    "filter": "switchBinary",
                    "switchBinary": {
                        "device": dev2,
                        "ref": "LT"
                    },

                },
                {
                    "filter": "toggleButton",
                    "toggleButton": {
                        "startScene": scen1,
                        "endScene": scen2
                    },

                },
            ],
            "logging": {
                level:"detailed",
                what:"start,end,scheduling"
            }
        }
    };
    config = baseConfig();
    sunset = new Date();
    sunset.setHours(19,0,0,0);
    ts.metrics[['probeType','=','astronomy_sun_altitude'].join(""),'metrics:sunset'] = sunset;
    ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";

    //ts.init(config);

    describe('start/stop presence=any', function() {
        it('start/end and reschedule presence=any', function() {
            ts.init(config);
            var times = ts.times;
            var start = times[0].switches[0].start;
            var end = times[0].switches[0].end;
            //console.log(times);
            assert.equal(readableTimes(start, end), "19:01->03:00");
            assert(start > now.getTime(), "Start time should be great than <now>");
            assert(end > times[0].switches[0].start.getTime(), "Start time should be greater than end time");
            assert(times[0].active, "Should be active");
            assert(!times[0].startTriggered, "Not yet triggered");

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on");
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");
            assert.equal(ts.getDev(scen1).timesSetTo['on'], 0, scen1 + " shouldn't have ever been turned on as start time not reached");
            assert.equal(ts.getDev(scen2).timesSetTo['on'], 0, scen2 + " shouldn't have ever been turned on as start time not reached");

            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(scen1).timesSetTo["on"], 1, scen1 + " should have been turned on once");
            assert.equal(ts.getDev(scen2).timesSetTo['on'], 0, scen2 + " shouldn't have ever been turned on as end time not reached");

            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");
            assert.equal(ts.getDev(scen1).timesSetTo["on"], 1, scen1 + " should have been turned on again");
            assert.equal(ts.getDev(scen2).timesSetTo['on'], 0, scen2 + " shouldn't have ever been turned on as end time not reached");

            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off as start time not reached");
            assert.equal(ts.getDev(scen2).timesSetTo['on'], 0, scen2 + " shouldn't have ever been turned on as end time not reached");

            now.setHours(now.getHours() + 24);
            now.setHours(3,1); // Just past end time for entry 0 in timetable
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(ts.getDev(scen2).timesSetTo['on'], 1, scen2 + " should have been turned on once as end time reached");
            assert.equal(ts.times[0].switches[0].start.getTime(), start.getTime()+24*60*60*1000, " start should have increased by 24 hours");
            assert.equal(ts.times[0].switches[0].end.getTime(), end.getTime()+24*60*60*1000, " end should have increased by 24 hours");
            assert.equal(ts.times[0].switches[2].start.getTime(), start.getTime()+24*60*60*1000, " start should have increased by 24 hours");
            assert.equal(ts.times[0].switches[2].end.getTime(), end.getTime()+24*60*60*1000, " end should have increased by 24 hours");
        });
    });

    describe('presence variation', function() {
        beforeEach(function() {
            ts.stop();
            controller.reset();
            config = baseConfig();
            now = new Date(baseNow.getTime());
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";
        });

        it('presence=home and at home', function() {
            config.timetable[0].presence = "home";
            ts.init(config);
            assert.equal(19, ts.times[0].switches[0].start.getHours());
            assert(ts.times[0].active, "Should be active");
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=home and away', function() {
            config.timetable[0].presence = "home";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert(ts.times[0].switches[0].start == null);
            assert(!ts.times[0].active, "Shouldn't be active");
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as away");
        });
    });

    describe('randomise', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            resetNow();
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        it('first timetable entry as randomise, to start tomorrow with start/end rand', function() {
            config.timetable[0].days = "Weekdays";
            config.timetable.splice(1,1);
            config.switches.splice(1,2); // Now only have 1 entry and 1 switch
            config.timetable[0].randomise = "yes";
            config.startRand.randType = "evenDown";
            config.endRand.randType = "evenUp";
            var maxAjdMins = 10;
            config.startRand.maxAdj = "00:" + maxAjdMins;
            config.endRand.maxAdj = "00:" + maxAjdMins;
            ts.init(config);
            assert.equal(ts.times[0].switches[0].start.getDay(), 0, "Start should be Sun");
            assert.equal(ts.times[0].switches[0].end.getDay(), 1, "End should be Mon");
            assert.equal(ts.times[0].switches[0].endSuspended, true, "End should be suspended");

            changeNow(0,19,1);
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            changeNow(1,3,maxAjdMins);
            ts.endAction(); // Should now be a Mon i.e. a weekday
            assert.equal(ts.times[0].switches[0].start.getDay(), 1, "Start should be Mon");
            assert.equal(ts.times[0].switches[0].startSuspended, false, "Start shouldn't be suspended");
            assert.equal(ts.times[0].switches[0].end.getDay(), 2, "End should be Tue");
            assert.equal(ts.times[0].switches[0].endSuspended, true, "End suspended until start runs");

            changeNow(0,19,1);
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");
            assert.equal(ts.times[0].switches[0].endSuspended, false, "End not suspended as start has triggered");
            changeNow(1,3,maxAjdMins);
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it('first timetable entry as randomise, has overall start randomise', function() {
            config.timetable[0].randomise = "yes";
            config.startRand.randType = "evenDown";
            delete config.logging.level;
            var maxAdjMins = 10;
            config.startRand.maxAdj = "00:" + maxAdjMins;
            var startBeforeRand = new Date(now.getTime());
            startBeforeRand.setHours(19,1);  // Matches start time in config
            console.log("startBeforeRand", startBeforeRand);
            var maxAdjMs = maxAdjMins * 60 * 1000;

            var randDiffs = [];
            var n = 30;
            _.times(n, function() {
                ts.init(config);
                var startAfterRand = ts.times[0].switches[0].start;
                console.log("startAfterRand", startAfterRand);
                var diffMs = startBeforeRand.getTime()-startAfterRand.getTime();
                randDiffs.push(diffMs);
                console.log("diffMs", diffMs);
                assert(diffMs >=0 && diffMs <= maxAdjMins*60*1000, " start time should have gone down between 0 & "
                    + maxAdjMins + " minutes");
                assert(ts.times[0].active, "Should be active");
            });
            console.log("difference for " + n + " randomisation is " + randDiffs);
            var aveRandDiffs = randDiffs.reduce(function(memo, num) {return memo+num}, 0) / randDiffs.length;
            var absDiff = Math.abs(aveRandDiffs - maxAdjMs/2);
            console.log("  average = " + aveRandDiffs);
            // TODO: sometimes this will fail ...
            assert(absDiff < 60*1000*2, "Diff of " + absDiff + "ms Ave adjust should be about half of max was " +
                aveRandDiffs + "ms for max change of " + maxAdjMs + "ms and half of that of " + maxAdjMs/2 + " ms");
        });

        it('first timetable entry as randomise, but no overall randomise', function() {
            config.timetable[0].randomise = "yes";
            ts.init(config);
            //console.log(times);
            assert.equal(19, ts.times[0].switches[0].start.getHours());
            assert(ts.times[0].active, "Should be active");
        });
    });

    describe('day variation', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            now = new Date(baseNow.getTime());
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        it('triggered weekend and enabled for weekdays', function () {
            config.timetable[0].days = "Weekdays";
            config.timetable[0].endTime = "19:03";
            ts.init(config);
            now.setHours(19, 1); // Now is Sun.  At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as it's a Sunday");
            now.setMinutes(3);
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off as it's a Sunday");
            var start = ts.times[0].switches[0].start;
            var end = ts.times[0].switches[0].end;
            assert.equal(start.getDay(), 1, dev1 + " should have now moved to start on Monday");
            assert.equal(end.getDay(), 1, dev1 + " should have now moved to end on Monday");
        });

    });

    describe('start type variation', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            now = new Date(baseNow.getTime());
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        /*it('start time to none', function () {
            config.timetable[0].startType = "none";
            now.setHours(19, 1);
            ts.init(config);
            ts.startAction();
            assert(ts.times[0].switches[0].start == null, "Null start time for startType none");
            config.timetable[0].endType = "none";
            ts.init(config);
            assert(ts.times[0].switches[0].start == null, "Null start time for startType none");
            assert(ts.times[0].switches[0].end == null, "Null end time for endType none");
            ts.startAction();
        });TODO: functionality not fully implemented*/
    });

    describe('config entries', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            now = new Date(baseNow.getTime());
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        it('parse entry config', function () {
            extra = {
                "Switches": ["ref1", "ref2"]
            };
            extra2 = {
                "Switches": ["ref1", "ref2"],
                "Days": [1, 3]
            };
            extra3 = {
                "Days": [0]
            };
            ts.init(config);
            assert.deepEqual(ts.parseEntryConfig(JSON.stringify(extra)), extra);
            assert.deepEqual(ts.parseEntryConfig("Switches:ref1, ref2"), extra);
            assert.deepEqual(ts.parseEntryConfig("S:ref1, ref2"), extra);
            assert.deepEqual(ts.parseEntryConfig("ref1, ref2"), extra);

            assert.deepEqual(ts.parseEntryConfig("Switches:ref1, ref2 Days:Mo,We"), extra2);

            assert.deepEqual(ts.parseEntryConfig("Days:Su"), extra3);
        });

        it('specific switch ref is referenced', function() {
            config.timetable[0].config = "LT"; // 2nd switch ref is LT
            ts.init(config);
            //console.log("entries", ts.entries);
            //console.log(JSON.stringify(ts.times, null, 2));
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo["on"], 1, dev2 + " should have been turned on once");
        });

        it('specific switch title is referenced', function() {
            config.timetable[0].config = "Dev2"; // 2nd switch title is Dev 2
            ts.init(config);
            //console.log("entries", ts.entries);
            //console.log(JSON.stringify(ts.times, null, 2));
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo["on"], 1, dev2 + " should have been turned on once");
        });

        it('specific switch refs - is not referenced', function() {
            config.timetable[0].config = "LX"; // No switch with this ref
            ts.init(config);
            //console.log(ts.entryConfigs);
            //console.log(ts.times);
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 0, dev2 + " should not have been turned on");
        });

        it('check days in entry config day matches', function() {
            config.timetable[0].config = "Days:Su";
            ts.init(config);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            now.setHours(19,1); // At start time for entry 0 in timetable
            //console.log(JSON.stringify(ts.times, null, 2));
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('check days in entry config day does not match', function() {
            config.timetable[0].config = "Days:Mo, We ";
            ts.init(config);
            //console.log(JSON.stringify(ts.times, null, 2));
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            now.setHours(19,1); // At start time for entry 0 in timetable
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
        });
    });

    describe('start after end', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            now = new Date(baseNow.getTime());
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        it('start, reschedule, end', function() {
            ts.init(config);
            now.setHours(19,1);
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            now.setHours(20,0);
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "away";
            ts.presenceChange();
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should still have been turned on once");
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " should not have been turned off");
            now.setHours(3,0);
            now.setHours(24+now.getHours());
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it("end shouldn't result in light off", function() {
            config.timetable[0].days = "Weekdays";
            ts.init(config);
            now.setHours(19,1);
            ts.startAction();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            now.setHours(3,0);
            now.setHours(24+now.getHours());
            ts.endAction();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");
        });
    });
});