var assert = require('assert');
//const
leftPad = require('left-pad');
var _ = require('underscore');

// Mocha tests using node assert
describe('TabularScheduler', function() {
    var baseNow = new Date(2017, 9, 8, 9, 1); // Sunday, BST

    beforeEach(function () {
        clock.setDateAndReset(baseNow);
        config = baseConfig();
        ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";
        //console.log("\n");
    });

    afterEach(function() {
        ts.stop();
        assert.equal(controller.getOnKeys(), '', 'Should be no callbacks still defined');
        controller.reset();
        console.log("\n");
    });

    var executeFile = require('../modules/executeFile');

    this.debugPrint = function(str) {
        console.log(clock.formatedDateTime() + " " + str);
    }

    dgbPrint = function() {
        /*console.log(_.reduce(arguments, function (a, b) {
            return a + " " + JSON.stringify(b)
        }, clock.formatedDateTime()));*/
    }

    this.debug = function() {
        //console.log(_.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
    };

    printCronEntries = function(entries) {
        var entries = controller.listCronEntries();
        dgbPrint("Cron entries:");
        for (var i=0; i<entries.length; i++) {
            dgbPrint("   ", entries[i][0], entries[i][1]);
        }
    }

    executeFile('automation/Utils.js', this);

    this._ = _;
    this.assert = assert;

    executeFile('test/AutomationControllerMock.js', this);
    executeFile('test/ClockMock.js', this);
    executeFile('test/BaseModuleMock.js', this);
    executeFile('TabularScheduler/index.js', this);

    var clock = new this.ClockMock(baseNow);
    var controller = new this.AutomationController(clock);

    this.setTimeout = function(func, millisecs) {
        //console.log("Got call to setTimeout for " + millisecs + "ms.");
        return clock.setTimeout(_.partial(func, arguments), millisecs);
    };

    this.clearTimeout = function(id) {
        //console.log("clearTime for " + id);
        clock.clearTimeout(id);
    };

    this.TabularScheduler.prototype.now = function() {
        return clock.getDate();
    };

    this.TabularScheduler.prototype.log = function(message) {
        self = this;
        console.log(clock.getHRDateformat(self.now()) + " " + message);
    };

    var ts = new this.TabularScheduler(1, controller);
    ts.meta.defaults.title = "Tabular Scheduler";
    var fmt = new this.Format();

    var printf = function() {
        console.log(clock.getHRDateformat(clock.getDate()) + ' ... ' + fmt.format.apply(fmt, arguments));
    };

    var dev1 = "ZWayVDev_zway_15-0-37";
    var vDev1 = controller.add(dev1, "Dev1", "switchBinary");
    var dev2 = "ZWayVDev_zway_1-0-1";
    var vDev2 = controller.add(dev2, "Dev2", "switchBinary");
    var dev3 = "ZWayVDev_zway_13-0-38";
    var vDev3 = controller.add(dev3, "Bedroom Light", "switchMultilevel");
    var sens1 = "ZWayVDev_zway_7-0-48-1";
    var vDevSens1 = controller.add(sens1, "Sens1");

    var sw1 = {
        "filter": "switchBinary",
        "switchBinary": {
            "device": dev1,
            "ref": "ref-for-dev1"
        }
    };

    var sw2 = {
        "filter": "switchBinary",
        "switchBinary": {
            "device": dev2,
            "ref": "LT"
        }

    };

    var sw3 = {
        "filter": "switchMultilevel",
        "switchMultilevel": {
            "device": "ZWayVDev_zway_13-0-38",
            "startLevel": 70,
            "endLevel": 0,
            "ref": "Bed"
        }
    };

    var oneSwitch = [sw1];

    var threeSwitches = [sw1, sw2, sw3];

    var baseConfig = function () {
        return {
            "timetable": [{
                "presence": "any",
                "randomise": "no",
                "days": "All",
                "startTime": "19:01",
                "endTime": "03:00"
            },
                {
                    "presence": "any",
                    "randomise": "yes",
                    "days": "All",
                    "startTime": "06:00",
                    "endTime": "07:00"
                }
            ],
            "activeHours": {
                "set":true,
                "startType": "time",
                "startTime":"16:00", // equiv to sunset
                "endType": "time",
                "endTime":"06:00"}, // equiv to sunrise
            "startRand": {
            },
            "endRand": {
            },
            "sensorTrigger": {
                "set":false,
                "sensors":["ZWayVDev_zway_7-0-48-1"],
                "timeout":"00:01:00",
                "config":"dev"
            },
            "switches": oneSwitch,
            "sensorTrigger": {
                "set":false,
                "sensors":["ZWayVDev_zway_7-0-48-1"],
                "timeout":"00:01:00"
            },
            "logging": "summary" // summary, detailed or veryDetailed
        }
    };

    sunset = new Date(baseNow);
    sunset.setHours(19,0,2,3);
    ts.metrics[['probeType','=','astronomy_sun_altitude'].join(""),'metrics:sunset'] = sunset;

    sunrise = new Date(baseNow);
    sunrise.setHours(6,59,59,3);
    ts.metrics[['probeType','=','astronomy_sun_altitude'].join(""),'metrics:sunrise'] = sunrise;


    describe('start/stop presence=any', function() {
        it('start/end, times within activeHours, and reschedule presence=any, 1 light', function() {
            ts.init(config);
            printCronEntries();
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLights[0].start;
            var end = scheduled[0].scheduledLights[0].end;
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 19:01->Mon 03:00");
            assert(start > clock.getTime(), "Start time should be greater than <now>");
            assert(end > scheduled[0].scheduledLights[0].start.getTime(), "Start time should be greater than end time");
            assert(scheduled[0].active, "Should be active");
            assert(!scheduled[0].startTriggered, "Not yet triggered");

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");

            clock.moveTo(19,1);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(19,2);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off as start time not reached");

            clock.moveTo(3,1); // Just past end time for entry 0 in timetabl
            assert.equal(ts.fmt.format("{:D1}->{:D1}", scheduled[0].scheduledLights[0].start, scheduled[0].scheduledLights[0].end),
                "Mon 19:01->Tue 03:00");
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(ts.scheduled[0].scheduledLights[0].start.getTime(), start.getTime()+24*60*60*1000, " start should have increased by 24 hours");
            assert.equal(ts.scheduled[0].scheduledLights[0].end.getTime(), end.getTime()+24*60*60*1000, " end should have increased by 24 hours");

            printCronEntries();
            printf("Active hours: {start:D1}->{end:D1}", ts.activeHours);
            clock.moveTo(10, 0);
            printf("Active hours: {start:D1}->{end:D1}", ts.activeHours);
        });

        it('start/end, start before activeHours and reschedule presence=any, 1 light', function() {
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
            ts.init(config);
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLights[0].start;
            var end = scheduled[0].scheduledLights[0].end;
            assert.equal(fmt.format("{:D1}->{:D1}", start, end), "Sun 16:00->Mon 03:00"); // Moved to activeHouse.startTime
            assert(start > clock.getTime(), "Start time should be greater than <now>");
            assert(end > scheduled[0].scheduledLights[0].start.getTime(), "Start time should be greater than end time");
            assert(scheduled[0].active, "Should be active");
            assert(!scheduled[0].startTriggered, "Not yet triggered"); // TODO: check startTriggered exists

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");

            clock.moveTo(16,0); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(16,2);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off as start time not reached");

            clock.moveTo( 3, 0); // At end for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(clock.getHRDateformat(ts.scheduled[0].scheduledLights[0].start), clock.getHRDateformat(new Date(start.getTime()+24*60*60*1000)), " start should have increased by 24 hours");
            assert.equal(clock.getHRDateformat(ts.scheduled[0].scheduledLights[0].end), clock.getHRDateformat(new Date(end.getTime()+24*60*60*1000)), " end should have increased by 24 hours");
        });

        it('start/end, start before activeHours and reschedule presence=any, 3 lights', function() {
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
            config.switches = threeSwitches;
            ts.init(config);

            clock.moveTo(16,0); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(16,2);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            clock.moveTo( 3, 0); // At end for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");

            clock.moveTo(6, 0);
            clock.moveTo(6, 1);
        });

        it('start/end and reschedule presence=any, set activeHours', function() {
            clock.moveToWithoutCronNotify(13,0);
            config.timetable[0].startTime = "14:00";
            ts.init(config);
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLights[0].start;
            var end = scheduled[0].scheduledLights[0].end;
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 16:00->Mon 03:00");

            ts.stop();
            config.activeHours.set = false;
            ts.init(config);
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLights[0].start;
            var end = scheduled[0].scheduledLights[0].end;
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 14:00->Mon 03:00");
        });
    });


    describe('simulate init after z-wave service is started', function() {
        beforeEach(function () {
            controller.hide(); // Causes devices to be hidden i.e. appears that they're not yet configured
        });

        it('initially vDevs not set - simulate waiting when this happens', function () {
            var vDev = controller.devices.get("ZWayVDev_zway_15-0-37");
            assert.equal(vDev, null);

            ts.init(config);

            controller.unhide();
            clock.moveBy(12000);
            //completeTimeout();

            vDev = controller.devices.get("ZWayVDev_zway_15-0-37");
            assert(!!vDev, "Simulated wait for devices to be initialised so vDev shouldn't be null");
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLights[0].start;
            var end = scheduled[0].scheduledLights[0].end;
            //console.log(scheduled);
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 19:01->Mon 03:00");
        });
    });

    describe('presence variation', function() {
        it('presence=home and at home', function() {
            config.timetable[0].presence = "home";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=home and away', function() {
            config.timetable[0].presence = "home";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert(ts.scheduled[0].scheduledLights[0].start == null);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as away");
        });

        it('presence=away and away', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=away and home->away', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";
            ts.init(config);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.handlePresence();
            assert(ts.scheduled[0].active, "Should be active");
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=away and vacation', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "vacation";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=vacation and vacation', function() {
            config.timetable[0].presence = "vacation";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "vacation";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should still have been turned on once");
        });

        it('presence=vacation and away', function() {
            config.timetable[0].presence = "vacation";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert(ts.scheduled[0].scheduledLights[0].start == null);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as away");
        });


        it('presence=none', function() {
            config.timetable[0].presence = 'none';
            ts.init(config);
            assert(!ts.scheduled[0].active, "Presence set to None so shouldn't be active");
        });
    });

    describe('period variation', function() {
        /*
            ^    ^   |   ^   ^    |   ^    ^
            b1   b2  s  i1  i2    e   a1   a2
            activeHours from s -> e
            times (b)efore, (i)n  and (a)fter
         */
        it('activeHours', function() {
            ts.init(config);

            var b1  = new Date(2018, 11, 3, 12, 0);
            var b2  = new Date(2018, 11, 3, 13, 0);
            var s   = new Date(2018, 11, 3, 16, 0);
            var i1  = new Date(2018, 11, 3, 19, 0);
            var i2  = new Date(2018, 11, 3, 22, 0);
            var e   = new Date(2018, 11, 4,  7, 0);
            var a1  = new Date(2018, 11, 4,  9, 0);
            var a2  = new Date(2018, 11, 4, 10, 0);

            var chgMins = function(time, mins) {
                return new Date(time.getTime() + mins*60*1000);
            };
            var addDays = function(time, days) {
                if (time === null) return null;
                return new Date(time.getTime() + days*24*60*60*1000);
            };

            var activeHours = {"start": s, "end": e};
            config.activeHours.startTime = "16:00";
            config.activeHours.endTime   = "07:00";

            var test1 = [
                // period, expected,   assertion comment
                [[b1, b2], [null, b2], "period before active - no intersection"],
                [[s, i1],  [s, i1],    "period overlap at start active hours"],
                [[b1, i1], [s,    i1], "period overlap at start active hours"],
                [[b1, a1], [s,    e ], "overlap is active hours"],
                [[i1, i2], [i1,   i2], "inside active hours"],
                [[i1, a1], [i1,   e ], "period overlap at end active hours"],
                [[a1, a2], [null, a2], "period after active - no intersection"]
            ];

            var testUs = function(now, test, activeHours, da) {
                test.forEach(function(aTest) {
                    var period = {"start": addDays(aTest[0][0], da), "end": addDays(aTest[0][1],da)};
                    var exp = {"start": addDays(aTest[1][0],da), "end": addDays(aTest[1][1],da)};
                    assert.deepEqual(ts.calcTimesWithinActiveHours(now, activeHours, period), exp, aTest[2]);
                });
            };
            testUs(chgMins(b1,-5), test1, activeHours, 0);
            testUs(chgMins(b1,+5 ), test1, activeHours, 0);
            testUs(chgMins(i1,-5), test1, activeHours, 0);
            testUs(chgMins(i1,+5 ), test1, activeHours, 0);
            testUs(chgMins(i2,+5 ), test1, activeHours, 0);

            testUs(chgMins(e,-5), test1, activeHours, 1);
        });
    });


    describe('randomise', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
        });

        it('first timetable entry as randomise, to start tomorrow with start/end rand', function() {
            config.timetable[0].days = "Weekdays";
            config.timetable.splice(1,1);
            config.switches.splice(1,2); // Now only have 1 entry and 1 switch
            config.timetable[0].randomise = "yes";
            config.startRand.randType = "evenDown";
            config.endRand.randType = "evenUp";
            var maxAdjMins = 10;
            config.startRand.maxAdj = "00:" + maxAdjMins;
            config.endRand.maxAdj = "00:" + maxAdjMins;
            ts.init(config);
            assert.equal(ts.scheduled[0].scheduledLights[0].start.getDay(), 0, "Start should be Sun");
            assert.equal(ts.scheduled[0].scheduledLights[0].end.getDay(), 1, "End should be Mon");
            assert.equal(ts.scheduled[0].scheduledLights[0].turnOffAtEnd, false, "Not turn off at end");

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveToWithoutCronNotify(3,maxAdjMins);
            ts.handleEnd(); // Should now be a Mon i.e. a weekday
            assert.equal(ts.scheduled[0].scheduledLights[0].start.getDay(), 1, "Start should be Mon");
            assert.equal(ts.scheduled[0].scheduledLights[0].end.getDay(), 2, "End should be Tue");

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            //assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");
            assert.equal(ts.scheduled[0].scheduledLights[0].turnOffAtEnd, true, "Turns off at end");
            clock.moveToWithoutCronNotify(3,maxAdjMins);
            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            //assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it('first timetable entry as randomise, has overall start randomise', function() {
            config.timetable[0].randomise = "yes";
            config.startRand.randType = "evenDown";
            delete config.logging.level;
            var maxAdjMins = 10;
            config.startRand.maxAdj = "00:" + maxAdjMins;
            var startBeforeRand = clock.getDate();
            startBeforeRand.setHours(19,1);  // Matches start time in config
            console.log("startBeforeRand", startBeforeRand);
            var maxAdjMs = maxAdjMins * 60 * 1000;

            var randDiffs = [];
            var n = 30;
            _.times(n, function() {
                ts.stop();
                ts.init(config);
                var startAfterRand = ts.scheduled[0].scheduledLights[0].start;
                console.log("startAfterRand", startAfterRand);
                var diffMs = startBeforeRand.getTime()-startAfterRand.getTime();
                randDiffs.push(diffMs);
                console.log("diffMs", diffMs);
                assert(diffMs >=0 && diffMs <= maxAdjMins*60*1000, " start time should have gone down between 0 & "
                    + maxAdjMins + " minutes");
                assert(ts.scheduled[0].active, "Should be active");
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
            //console.log(scheduled);
            assert.equal(19, ts.scheduled[0].scheduledLights[0].start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
        });
    });

    describe('day variation', function() {
        it('triggered weekend and enabled for weekdays', function () {
            config.timetable[0].days = "Weekdays";
            config.timetable[0].endTime = "19:03";
            ts.init(config);
            clock.moveToWithoutCronNotify(19, 1); // Now is Sun.  At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as it's a Sunday");
            clock.moveToWithoutCronNotify(19,3);
            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off as it's a Sunday");
            var start = ts.scheduled[0].scheduledLights[0].start;
            var end = ts.scheduled[0].scheduledLights[0].end;
            assert.equal(start.getDay(), 1, dev1 + " should have now moved to start on Monday");
            assert.equal(end.getDay(), 1, dev1 + " should have now moved to end on Monday");
        });

    });

    describe('light changes', function() {
        it('note light changed status', function () {
            ts.init(config);
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");

            console.log("Lights before on:" + JSON.stringify(ts.lights));
            clock.moveToWithoutCronNotify(19, 1); // Now is Sun.  At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            console.log("Lights after on:" + JSON.stringify(ts.lights));

            clock.moveToWithoutCronNotify(19, 1);
            clock.moveToWithoutCronNotify(3,1); // Just past end time for entry 0 in timetable
            ts.handleEnd();
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off");
        });

    });

    describe('sensor trigger', function() {
        beforeEach(function () {
            config.activeHours.set = false;
            config.sensorTrigger.set = true;
        });

        it('sensor trigger - no active times, schedule not activating', function () {
            ts.init(config);
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");

            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off when sensor triggered off");

            console.log("Lights before sensor triggered:" + JSON.stringify(ts.lights));

            vDevSens1.performCommand('on');
            console.log("Lights after sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");

            clock.moveBy(121*1000);
            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on as off timeout not yet triggerd");

            clock.moveBy(60*1000);
            //completeTimeout();
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be off as off timeout triggered");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it('sensor trigger - active times, schedule not activating', function () {
            config.activeHours.set = true;
            config.switches = threeSwitches;
            ts.init(config);

            console.log("Lights before sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");

            clock.moveToWithoutCronNotify(15,0); // Before active time
            vDevSens1.performCommand('on');
            console.log("Lights after sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");

            clock.moveToWithoutCronNotify(16,1); // After active time
            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
        });

        it('sensor trigger - no active times, schedule not activating, with config limiting switches', function () {
            config.switches = threeSwitches;
            config.sensorTrigger.config = "dev"; // Only matches first 2 switches
            ts.init(config);
            console.log("Lights before sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.lights.byDevice[dev3].onStatus, false, "light should be marked as off");
            vDevSens1.performCommand('on');
            console.log("Lights after sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 1, dev2 + " should have been turned on");
            assert.equal(ts.getDev(dev3).timesSetTo['on'], 0, dev3 + " shouldn't have been turned on");

            vDev3.performCommand("exact", {"level": 80});
            assert.equal(vDev3.timesSetTo['on'], 1, dev3 + " should have been turned on");

            vDevSens1.performCommand('off');
            clock.moveBy(60*1000);
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev2 + " should have been turned off");
            assert.equal(ts.getDev(dev3).timesSetTo['off'], 0, dev3 + " shouldn't have been turned off");
        });

        it('sensor trigger - no active times, schedule activating after sensor trigger', function () {
            ts.init(config);

            clock.moveToWithoutCronNotify(19,0); // 1 minute before start time for entry 0 in timetable
            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have tried to turn on twice");

            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on as off timeout not yet triggered");

            clock.moveBy(60*1000);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on because schedule started");
        });

        it('sensor trigger - no active times, schedule activating before sensor trigger', function () {
            ts.init(config);

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have tried to turn on once");

            clock.moveToWithoutCronNotify( 0, 10);
            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have tried to turn on twice");

            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on as off timeout not yet triggered");

            clock.moveBy(60*1000);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on because schedule turned it on");
        });

    });

    describe('activeHouse start/end type variation', function() {
        it('start time set to sunsetMinus', function() {
            config.timetable[0].startTime = "16:00";
            config.activeHours.set = true;
            config.activeHours.startType = "sunsetMinus";
            config.activeHours.startTime = "00:30";
            config.activeHours.endType = "sunriseMinus";
            config.activeHours.endTime = "00:00";
            ts.init(config);
            assert.equal(ts.fmt.format("{:D1}->{:D1}", ts.scheduled[0].scheduledLights[0].start, ts.scheduled[0].scheduledLights[0].end),
                "Sun 18:30->Mon 03:00");
        });


        //@@@ add more here
    });

    // TODO: make sure partial matches don't work if there are full matches.
    describe('config entries', function() {
        beforeEach(function() {
            config.switches = threeSwitches;
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
            //console.log(JSON.stringify(ts.scheduled, null, 2));
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo["on"], 1, dev2 + " should have been turned on once");
        });

        it('specific switch title is referenced', function() {
            config.timetable[0].config = "Dev2"; // 2nd switch title is Dev 2
            ts.init(config);
            //console.log("entries", ts.entries);
            //console.log(JSON.stringify(ts.scheduled, null, 2));
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo["on"], 1, dev2 + " should have been turned on once");
        });

        it('switch title referenced via partial match using regexp', function() {
            config.timetable[0].config = "dev"; // first 2 switch titles include dev so regexp will match
            ts.init(config);

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 1, dev2 + " should have been turned on once");
            assert.equal(ts.getDev(dev3).timesSetTo['on'], 0, dev3 + " should not have been turned on");
        });

        it('switch title referenced via regexp', function() {
            config.timetable[0].config = "outside.*(front|side)"; // first 2 switch titles include dev so regexp will match
            vDev1.setTmpTitle("OUTSIDE - front light");
            vDev2.setTmpTitle("OUTSIDE - back light");
            vDev3.setTmpTitle("OUTSIDE - side light");
            ts.init(config);

            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 0, dev2 + " should not have been turned on");
            assert.equal(ts.getDev(dev3).timesSetTo['on'], 1, dev3 + " should have been turned on once");

        });

        it('specific switch refs - is not referenced', function() {
            config.timetable[0].config = "LX"; // No switch with this ref
            ts.init(config);
            //console.log(ts.entryConfigs);
            //console.log(ts.scheduled);
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 0, dev2 + " should not have been turned on");
        });

        it('check days in entry config day matches', function() {
            config.timetable[0].config = "Days:Su";
            ts.init(config);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            //console.log(JSON.stringify(ts.scheduled, null, 2));
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('check days in entry config day does not match', function() {
            config.timetable[0].config = "Days:Mo, We ";
            ts.init(config);
            //console.log(JSON.stringify(ts.scheduled, null, 2));
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
            clock.moveToWithoutCronNotify(19,1); // At start time for entry 0 in timetable
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");
        });
    });

    describe('start after end', function() {
        it('start, reschedule, end', function() {
            ts.init(config);
            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            clock.moveToWithoutCronNotify(20,0);
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "away";
            ts.handlePresence();
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should still have been turned on once");
            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " should not have been turned off");
            clock.moveToWithoutCronNotify(3,0);
            clock.moveToWithoutCronNotify(3,0);
            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it("end shouldn't result in light off", function() {
            config.timetable[0].days = "Weekdays";
            ts.init(config);
            clock.moveToWithoutCronNotify(19,1);
            ts.handleStart();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            clock.moveToWithoutCronNotify(3,0);
            clock.moveToWithoutCronNotify(3,0);
            ts.handleEnd();
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");
        });
    });

    describe('formatting', function() {
        it('obj formatting', function() {
            var obj = {
                "name": "John",
                "age":  35
            }
            var d = new Date(2018,10,27,5,3,0);
            var i = 10;

            assert.equal(fmt.format("{name}", obj), "John");

            assert.equal(fmt.format("{:S}", obj), '{"name":"John","age":35}'); // TODO: add with no formatting
            assert.equal(fmt.format("{:D1}", d), "Tue 05:03");

            assert.equal(fmt.format("{:D1}->{:D1}", d, d), "Tue 05:03->Tue 05:03");
            //assert.equal(fmt.format("{:D1} i={}", d, i), "Tue 05:03 i=10");
        });

        it('non obj formatting', function() {
            var t = "Hi there";
            var i = 21;

            assert.equal(fmt.format("t={} i={}", t, i), "t=Hi there i=21");
            assert.equal(fmt.format("t={0} i={1}", t, i), "t=Hi there i=21");
            assert.equal(fmt.format("t={1} i={0}", i, t), "t=Hi there i=21");
        });
    });
});