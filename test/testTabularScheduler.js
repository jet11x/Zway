//var assert = require('assert');
var assert = require('chai').assert;
var sinon = require('sinon');
var logging = "summary"; // summary, detailed or veryDetailed

//const
leftPad = require('left-pad');
var _ = require('underscore');

/*
TODO:
  - ensure timeouts/intervals are cleared down
  - not sure sensor correctly controls lights if none listed under sensor, add test for this.
     - presence shouldn't matter for sensor?
 */

// Mocha tests using chai assert
describe('TabularScheduler', function() {
    var baseNow = new Date(2017, 9, 8, 9, 1); // Sunday, BST

    var setSunset = function(hours, min, sec, ms) {
        var sunset = clock.getDate();
        sunset.setHours(hours,min,sec,ms);
        ts.metrics[['probeType','=','astronomy_sun_altitude'].join(""),'metrics:sunset'] = sunset;
    };

    var setSunrise = function(hours, min, sec, ms) {
        var sunrise = clock.getDate();
        sunrise.setHours(hours,min,sec,ms);
        ts.metrics[['probeType','=','astronomy_sun_altitude'].join(""),'metrics:sunrise'] = sunrise;
    };

    beforeEach(function () {
        clock.setDateAndReset(baseNow);
        config = baseConfig();
        ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";
        setSunrise(6, 59, 59, 3);
        setSunset(19, 0, 2, 3);
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
        console.log(clock.formatedDateTime(true) + " " + str);
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
        //printf("Cron entries:");
        for (var i=0; i<entries.length; i++) {
            //printf("   {:S}, {:S}", entries[i][0], entries[i][1]);
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

    this.setInterval = function(func, millisecs) {
        return clock.setInterval(_.partial(func, arguments), millisecs);
    };

    this.clearInterval = function(id) {
        clock.clearInterval();
    }

    this.TabularScheduler.prototype.now = function() {
        return clock.getDate();
    };

    this.TabularScheduler.prototype.log = function(message) {
        self = this;
        //console.log(clock.getHRDateformat(self.now()) + " " + message);
        console.log(clock.getDateFormat(self.now(), true) + " " + message);
    };

    var ts = new this.TabularScheduler(1, controller);
    ts.meta.defaults.title = "TabularScheduler";
    ts.langFile = {m_title:"TabularScheduler"};
    ts.getInstanceTitle = function() {return "TabularScheduler"};
    var fmt = new this.TabularFormat();

    var printf = function() {
        //console.log(clock.getHRDateformat(clock.getDate()) + ' ... ' + fmt.format.apply(fmt, arguments));
        console.log(clock.getDateFormat(clock.getDate(), true) + ' ... ' + fmt.format.apply(fmt, arguments));
    };

    var dev1 = "ZWayVDev_zway_15-0-37";
    var vDev1 = controller.add(dev1, "Dev1", "switchBinary");
    var dev2 = "ZWayVDev_zway_1-0-1";
    var vDev2 = controller.add(dev2, "Dev2", "switchBinary");
    var dev3 = "ZWayVDev_zway_13-0-38";
    var vDev3 = controller.add(dev3, "Bedroom Light", "switchMultilevel");
    var sens1 = "ZWayVDev_zway_7-0-48-1";
    var vDevSens1 = controller.add(sens1, "Sens1");

    var baseConfig = function () {
        return {
            "timetable": [{
                    "presence": "any",
                    "randomise": "no",
                    "days": "0,1,2,3,4,5,6",
                    "startTime": "19:01",
                    "endTime": "03:00",
                    "device": dev1
                },
                {
                    "presence": "any",
                    "randomise": "no",
                    "days": "0,1,2,3,4,5,6",
                    "startTime": "06:00",
                    "endTime": "07:00",
                    "device": dev2
                }
            ],
            "activeHours": {
                "set":true,
                "startType": "time",
                "startTime":"16:00", // equiv to sunset
                "endType": "time",
                "endTime":"06:00"}, // equiv to sunrise
            "maxRand": 15,
            "sensorTrigger": {
                "set":false,
                "sensors":["ZWayVDev_zway_7-0-48-1"],
                "timeout":"1",
                "switches": [dev1, dev2]
            },
            "pollInterval": 60,
            "logging": logging
        }
    };

    describe('active hours', function() {
        it('moving days', function() {
            config.activeHours.startType = "sunset";
            config.activeHours.startTime = "00:00";
            config.activeHours.endType = "sunrise";
            config.activeHours.endTime = "00:00";
            ts.init(config);
            assert.equal(ts.fmt.format("{start:D1}->{end:D1}", ts.activeHours),"Sun 19:00->Mon 06:59");
            assert.equal(ts.fmt.format("{nextstart:D1}->{nextend:D1}", ts.activeHours),"Mon 19:00->Tue 06:59");
            clock.moveTo(0, 1); // Move to next day
            setSunrise(6, 58, 59, 3);
            setSunset(19, 1, 2, 3);
            clock.moveTo(8, 0);
            printf("Active hours: {start:D1}->{end:D1}", ts.activeHours);
            printf("Active hours: {nextstart:D1}->{nextend:D1}", ts.activeHours);
            assert.equal(ts.fmt.format("{start:D1}->{end:D1}", ts.activeHours),"Mon 19:00->Tue 06:59");
            assert.equal(ts.fmt.format("{nextstart:D1}->{nextend:D1}", ts.activeHours),"Tue 19:01->Wed 06:58");

        });
    });

    describe('start/stop presence=any', function() {
        it('start/end, times within activeHours, and reschedule presence=any, 1 light', function() {
            ts.init(config);
            var eventTimes = ts.getEventTimes();
            var scheduled = ts.scheduled[0];
            assert.equal(ts.fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Sun 19:01->Mon 03:00");
            //assert(start > clock.getTime(), "Start time should be greater than <now>");
            //assert(end > scheduled[0].scheduledLights[0].start.getTime(), "Start time should be greater than end time");
            assert(scheduled.active, "Should be active");
            assert(!scheduled.startTriggered, "Not yet triggered");

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");

            clock.moveTo(19,1);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(19,2);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off as start time not reached");

            clock.moveTo(3,1); // Just past end time for entry 0 in timetable
            assert.equal(ts.fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Mon 19:01->Tue 03:00");
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            //assert.equal(ts.scheduled[0].scheduledLight.start.getTime(), start.getTime()+24*60*60*1000, " start should have increased by 24 hours");
            //assert.equal(ts.scheduled[0].scheduledLight.end.getTime(), end.getTime()+24*60*60*1000, " end should have increased by 24 hours");

            printf("Active hours: {start:D1}->{end:D1}", ts.activeHours);
            clock.moveTo(10, 0);
            printf("Active hours: {start:D1}->{end:D1}", ts.activeHours);
        });

        it('start/end, start before activeHours and reschedule presence=any, 1 light', function() {
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
            ts.init(config);
            var scheduled = ts.scheduled[0];
            var start = scheduled.scheduledLight.start;
            var end = scheduled.scheduledLight.end;
            assert.equal(fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Sun 16:00->Mon 03:00"); // Moved to activeHouse.startTime
            //assert(start > clock.getTime(), "Start time should be greater than <now>");
            //assert(end > scheduled[0].scheduledLights[0].start.getTime(), "Start time should be greater than end time");
            assert(scheduled.active, "Should be active");

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");

            clock.moveTo(16,0); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(16,2);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            clock.moveTo( 3, 0); // At end for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(clock.getHRDateformat(scheduled.scheduledLight.start), clock.getHRDateformat(new Date(start.getTime()+24*60*60*1000)), " start should have increased by 24 hours");
            assert.equal(clock.getHRDateformat(scheduled.scheduledLight.end), clock.getHRDateformat(new Date(end.getTime()+24*60*60*1000)), " end should have increased by 24 hours");
        });

        // TODO: add 3rd switch test
        it('start/end, start before activeHours and reschedule presence=any, 3 lights', function() {
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
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

        it('start/end, start before activeHours and reschedule presence=any, multilevel', function() {
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
            config.timetable[0].device = dev3;
            config.onLevel = 55;
            ts.init(config);

            clock.moveTo(16,0); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev3).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev3).get("metrics:level"), 55);

            clock.moveTo(16,2);
            assert.equal(ts.getDev(dev3).timesSetTo["on"], 1, dev1 + " shouldn't be triggered to on again");
            assert.equal(ts.getDev(dev3).timesSetTo['off'], 0, dev1 + " shouldn't have ever been turned off");

            clock.moveTo( 3, 0); // At end for entry 0 in timetable
            assert.equal(ts.getDev(dev3).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(ts.getDev(dev3).get("metrics:level"), 0);

            clock.moveTo(6, 0);
            clock.moveTo(6, 1);
        });

        it('start/end and reschedule presence=any, set activeHours', function() {
            clock.moveToWithoutCronNotify(13,0);
            config.timetable[0].startTime = "14:00";
            ts.init(config);
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLight.start;
            var end = scheduled[0].scheduledLight.end;
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 16:00->Mon 03:00");

            ts.stop();
            config.activeHours.set = false;
            ts.init(config);
            var scheduled = ts.scheduled;
            var start = scheduled[0].scheduledLight.start;
            var end = scheduled[0].scheduledLight.end;
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 14:00->Mon 03:00");
        });


        it('start/end, start before activeHours and sunset moved earlier on reschedule, 1 light', function() {
            setSunset(18,3,2,3);
            config.activeHours.startType = "sunset";
            config.timetable[0].startTime = "15:00"; // Before activeHours.startTime;
            ts.init(config);
            var scheduled = ts.scheduled[0];
            var start = scheduled.scheduledLight.start;
            var end = scheduled.scheduledLight.end;
            assert.equal(fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Sun 18:03->Mon 03:00"); // Moved to activeHouse.startTime
            //assert(start > clock.getTime(), "Start time should be greater than <now>");
            //assert(end > scheduled[0].scheduledLights[0].start.getTime(), "Start time should be greater than end time");
            assert(scheduled.active, "Should be active");

            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have ever been turned on as start time not reached");

            clock.moveTo(18,3); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");

            clock.moveTo(3, 0);
            assert.equal(fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Mon 18:03->Tue 03:00");
            setSunset(18,5,0, 0);
            clock.moveTo(6, 0);

            assert.equal(ts.getDev(dev1).timesSetTo["off"], 1, dev1 + " should have been turned off once as end time reached");
            assert.equal(clock.getHRDateformat(scheduled.scheduledLight.start), clock.getHRDateformat(new Date(start.getTime()+24*60*60*1000)), " start should have increased by 24 hours");
            assert.equal(clock.getHRDateformat(scheduled.scheduledLight.end), clock.getHRDateformat(new Date(end.getTime()+24*60*60*1000)), " end should have increased by 24 hours");

            /*
            assert.equal(fmt.format("{start:D1}->{end:D1}", scheduled.scheduledLight), "Mon 18:05->Tue 03:00"); // Moved to activeHouse.startTime

            clock.moveTo(18, 3);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
            clock.moveTo(18, 5);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 2, dev1 + " should have been turned on twice");
            */
            //@@@
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
            var start = scheduled[0].scheduledLight.start;
            var end = scheduled[0].scheduledLight.end;
            //console.log(scheduled);
            assert.equal(ts.fmt.format("{:D1}->{:D1}", start, end), "Sun 19:01->Mon 03:00");
        });
    });

    describe('vary poll interval', function() {
        it('poll interval 5 secs', function () {
            config.pollInterval = 5;
            clock.moveBy(100);
            ts.init(config);
            clock.setIncrement(100);
            clock.moveBy(4800);
            assert(ts.tmpTimeoutId !== undefined);
            clock.moveBy(100);
            assert(ts.tmpTimeoutId === undefined);
            clock.setIncrement(1000);
            clock.moveBy(55000);
            var intervals = clock.getIntervals();
            printf("Interval 0: " + clock.getDateFormat(intervals[0], true));
            clock.setIncrement(60*1000);
            clock.moveTo(19, 0); // 1 minutes before start time for entry 0 in timetable
            clock.moveBy(50*1000);
            clock.setIncrement(1000);
            clock.moveBy(9000);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 0);
            var intervals = clock.getIntervals();
            printf("Interval 0: " + clock.getDateFormat(intervals[0], true));
            clock.moveBy(1000);
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });
    });

    describe('presence variation', function() {
        it('presence=home and at home', function() {
            config.timetable[0].presence = "home";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLight.start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('presence=home and away', function() {
            config.timetable[0].presence = "home";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert(ts.scheduled[0].scheduledLight.start == null);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as away");
        });

        it('presence=away and away', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLight.start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('presence=away and home->away', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "home";
            ts.init(config);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.handlePresence();
            assert(ts.scheduled[0].active, "Should be active");
            assert.equal("Sun 8-Oct 19:01", ts.fmt.format("{:Dt}",ts.scheduled[0].scheduledLight.start));
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('presence=away and vacation', function() {
            config.timetable[0].presence = "away";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "vacation";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLight.start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('presence=vacation and vacation', function() {
            config.timetable[0].presence = "vacation";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "vacation";
            ts.init(config);
            assert.equal(19, ts.scheduled[0].scheduledLight.start.getHours());
            assert(ts.scheduled[0].active, "Should be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo["on"], 1, dev1 + " should have been turned on once");
        });

        it('presence=vacation and away', function() {
            config.timetable[0].presence = "vacation";
            ts.metrics[['probeType','=','presence'].join(""),'metrics:mode'] = "away";
            ts.init(config);
            assert(ts.scheduled[0].scheduledLight.start == null);
            assert(!ts.scheduled[0].active, "Shouldn't be active");
            clock.moveTo(19,1); // At start time for entry 0 in timetable
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
           var b1  = new Date(2018, 11, 3, 12, 0);
           var b2  = new Date(2018, 11, 3, 13, 0);
           var s   = new Date(2018, 11, 3, 16, 0);
           var i1  = new Date(2018, 11, 3, 19, 0);
           var i2  = new Date(2018, 11, 3, 22, 0);
           var e   = new Date(2018, 11, 4,  7, 0);
           var a1  = new Date(2018, 11, 4,  9, 0);
           var a2  = new Date(2018, 11, 4, 10, 0);

           clock.setDateAndReset(b1);
           config.activeHours.startTime = "16:00"; // s above
           config.activeHours.endTime   = "07:00"; // e above
           ts.init(config);

           var chgMins = function(time, mins) {
               return new Date(time.getTime() + mins*60*1000);
           };
           var addDays = function(time, days) {
               if (time === null) return null;
               return new Date(time.getTime() + days*24*60*60*1000);

           };
           var activeHours = ts.activeHours;

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


    //TODO: put back tests
    describe('randomise', function() {
        beforeEach(function () {
            ts.stop();
            controller.reset();
            config = baseConfig();
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "home";
            sinon.stub(Math, 'random').returns(0.5); // 10*0.5 = 5 minutes

        });

        afterEach(function () {
            Math.random.restore();
        });

        it('first timetable entry as randomise, inside active hours, to start tomorrow with start/end rand', function() {
            config.timetable[0].days = "1,2,3,4,5";
            config.timetable.splice(1,1); // Now only have 1 entry
            config.timetable[0].randomise = "yes";
            config.maxRand = 10;
            // "startTime": "19:01" on Sun
            // "endTime": "03:00",
            ts.init(config);
            assert.equal(ts.fmt.format("{origstart:D1}=>{origend:D1}", ts.scheduled[0].scheduledLight), "Sun 19:01=>Mon 03:00");
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>-");

            clock.moveTo(19,1);
            assert.equal(ts.fmt.format("{origstart:D1}=>{origend:D1}", ts.scheduled[0].scheduledLight), "Sun 19:01=>Mon 03:00");
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>-");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveTo(3, 0); // Should now be a Mon i.e. a weekday
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "Mon 19:06=>Tue 02:55");

            clock.moveTo(19, 5);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "Mon 19:06=>Tue 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off"); //
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");

            clock.moveTo( 19, 6);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>Tue 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveTo(2, 54);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>Tue 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveTo(2, 55);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>-");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");

            clock.moveTo(3, 0);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "Tue 19:06=>Wed 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");

            clock.moveTo(19, 6);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "-=>Wed 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have been turned on twice");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");

            clock.moveTo(3, 00);
            assert.equal(ts.fmt.format("{start:D1}=>{end:D1}", ts.scheduled[0].scheduledLight), "Wed 19:06=>Thu 02:55");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have been turned on twice");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 2, dev1 + " should have been turned off twice");
        });

        it('first timetable entry as randomise, outside active hours', function() {
            config.timetable.splice(1,1); // Now only have 1 entry
            config.timetable[0].randomise = "yes";
            config.maxRand = 10;
            // Active Hours 16:00 -> 06:00
            config.timetable[0].startTime = "15:35";
            config.timetable[0].endTime = "07:40";
            ts.init(config);
            printf("{:S}", ts.scheduled[0].scheduledLight);
            assert.equal(ts.fmt.format("{start:D1}->{end:D1}", ts.scheduled[0].scheduledLight), "Sun 16:05->Mon 05:55");

            clock.moveTo(16,4);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveTo(16,5);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveTo(5, 54);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveBy(60*1000-1); // 1ms before it should be turned off
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off");

            clock.moveBy(1);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
            assert.isNull(ts.scheduled[0].scheduledLight.end, "End should be null to avoid re-triggering end");
        });
    });

    describe('day variation', function() {
        it('triggered weekend and enabled for weekdays', function () {
            config.timetable[0].days = "1,2,3,4,5";
            config.timetable[0].endTime = "19:03";
            ts.init(config);
            clock.moveTo(19, 1); // Now is Sun.  At start time for entry 0 in timetable
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on as it's a Sunday");
            clock.moveTo(19,3);
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " shouldn't have been turned off as it's a Sunday");
            var start = ts.scheduled[0].scheduledLight.start;
            var end = ts.scheduled[0].scheduledLight.end;
            assert.equal(start.getDay(), 1, dev1 + " should have now moved to start on Monday");
            assert.equal(end.getDay(), 1, dev1 + " should have now moved to end on Monday");
        });

    });

    describe('light changes', function() {
        it('note light changed status', function () {
            ts.init(config);
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");

            console.log("Lights before on:" + JSON.stringify(ts.lights));
            clock.moveTo(19, 1); // Now is Sun.  At start time for entry 0 in timetable
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            console.log("Lights after on:" + JSON.stringify(ts.lights));

            clock.moveTo(19, 1);
            clock.moveTo(3,1); // Just past end time for entry 0 in timetable
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 2, dev1 + " should have been turned off");
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
            ts.init(config);

            console.log("Lights before sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");

            clock.moveTo(15,0); // Before active time
            vDevSens1.performCommand('on');
            console.log("Lights after sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " should not have been turned on");

            clock.moveTo(16,1); // After active time
            assert.equal(ts.vDev.get('metrics:level'), 'on');

            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
        });

        it('sensor trigger - no active times, schedule not activating, only one switches', function () {
            config.sensorTrigger.switches = [dev1];
            ts.init(config);
            console.log("Lights before sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, false, "light should be marked as off");
            assert.equal(ts.lights.byDevice[dev2].onStatus, false, "light should be marked as off");
            vDevSens1.performCommand('on');
            console.log("Lights after sensor triggered:" + JSON.stringify(ts.lights));
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            assert.equal(ts.getDev(dev2).timesSetTo['on'], 0, dev2 + " should have been turned on");

            vDev2.performCommand("exact", {"level": 80});
            assert.equal(vDev2.timesSetTo['on'], 1, dev3 + " should have been turned on");

            vDevSens1.performCommand('off');
            clock.moveBy(60*1000);
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off");
            assert.equal(ts.getDev(dev3).timesSetTo['off'], 0, dev2 + " shouldn't have been turned off");
        });

        it('sensor trigger - no active times, schedule activating after sensor trigger', function () {
            ts.init(config);

            clock.moveTo(19,0); // 1 minute before start time for entry 0 in timetable
            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");

            clock.moveTo(19,1);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have tried to turn on twice");

            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on as off timeout not yet triggered");

            clock.moveBy(60*1000);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on because schedule started");
        });

        it('sensor trigger - no active times, schedule activating before sensor trigger', function () {
            ts.init(config);

            clock.moveTo(19,1);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have tried to turn on once");

            clock.moveTo( 0, 10);
            vDevSens1.performCommand('on');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should be marked as on");
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 2, dev1 + " should have tried to turn on twice");

            vDevSens1.performCommand('off');
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on as off timeout not yet triggered");

            clock.moveBy(60*1000);
            assert.equal(ts.lights.byDevice[dev1].onStatus, true, "light should still be on because schedule turned it on");
        });

    });

    describe('activeHours start/end type variation', function() {
        it('start time set to sunsetMinus', function() {
            config.timetable[0].startTime = "16:00";
            config.activeHours.set = true;
            config.activeHours.startType = "sunsetMinus";
            config.activeHours.startTime = "00:30";
            config.activeHours.endType = "sunriseMinus";
            config.activeHours.endTime = "00:00";
            ts.init(config);
            assert.equal(ts.fmt.format("{:D1}->{:D1}", ts.scheduled[0].scheduledLight.start, ts.scheduled[0].scheduledLight.end),
                "Sun 18:30->Mon 03:00");
            printf("metrics {:S}", ts.vDev.metrics);
            assert.equal(ts.vDev.get("metrics:level"), 'off', 'Not in active hours so level should be off');
        });

        //TODO: add more here
    });

    describe('config of days', function() {
        it('all', function() {
            assert.sameMembers(ts.getDays(["0,1,2,3,4,5,6"]), [0,1,2,3,4,5,6]);
        });

        it('mon & tue', function() {
            assert.sameMembers(ts.getDays(["2", "1"]), [1,2]);
        });

        it('weekend & fri', function() {
            assert.sameMembers(ts.getDays(["5", "0,6"]), [0,6,5]);
        });

        it('weekdays & fri', function() {
            assert.sameMembers(ts.getDays(["5", "1,2,3,4,5"]), [1,2,3,4,5]);
        });
    });

    describe('start after end', function() { //TODO: improve name
        it('start, reschedule, end', function() {
            ts.init(config);
            clock.moveTo(19,1);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should have been turned on");
            clock.moveTo(20,0);
            ts.metrics[['probeType', '=', 'presence'].join(""), 'metrics:mode'] = "away";
            ts.handlePresence();
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 1, dev1 + " should still have been turned on once");
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 0, dev1 + " should not have been turned off");
            clock.moveTo(3,0);
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
        });

        it("end shouldn't result in light off", function() {
            config.timetable[0].days = "1,2,3,4,5";
            ts.init(config);
            clock.moveTo(19,1);
            assert.equal(ts.getDev(dev1).timesSetTo['on'], 0, dev1 + " shouldn't have been turned on");
            clock.moveTo(3,0);
            clock.moveTo(3,0);
            assert.equal(ts.getDev(dev1).timesSetTo['off'], 1, dev1 + " should have been turned off once");
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