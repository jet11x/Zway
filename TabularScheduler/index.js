/*** TabularScheduler Z-Way HA module *******************************************

 Version: 0.0.3
 (c) John Talintyre, 2017
 -----------------------------------------------------------------------------
 -----------------------------------------------------------------------------
 Author: John Talintyre
 Description: A table of start/end times, with criteria including: presence,
 sunrise/sunset with offset, day of week.  Entries can have their times
 randomised.
 ******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function TabularScheduler(id, controller) {
    // Call superconstructor first (AutomationModule)
    TabularScheduler.super_.call(this, id, controller);

    this.cronName = undefined;
    this.times = {};
}

inherits(TabularScheduler, BaseModule);

_module = TabularScheduler;

/*
TODO: do I want to retain none for start/end?  If so link to next/previous entry?
              if start not there then would use previous start and the earliest end would win
              if end not there then would use the next end, earliest start would win
                 e.g. which is earliest between 6pm and sunset?
         For now removed e.g.
         startType": {
              "optionLabels": [
                "None",  <---- removed
TODO: where none for end check re-scheduled
TODO: where none for start how deal with day for end?

TODO: complete move to en.json
TODO: improve description
TODO: randomized entries don't always move to next day when re-scheduled, make sure day changes?

How start/end are triggered
  Check the times against recorded times in self.times
     note per entry/switch when each start time is triggered
     when end time has triggered for an entry/switch then reschedule if needed
 */

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

TabularScheduler.prototype.init = function (config) {
    TabularScheduler.super_.prototype.init.call(this, config);

    var self = this;
    self.cronName = "TabularScheduler." + self.id;
    self.dayCheck = {
        "All": _.range(0, 7),
        "Weekends": [0, 6],
        "Weekdays": _.range(1, 6)
    };
    self.abbrevs = {"S": "Switches", "D": "Days"};
    self.dayMap = {"Su": 0, "Mo": 1, "Tu": 2, "We": 3, "Th": 4, "Fr": 5, "Sa": 6};
    self.days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    self.months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    self.logging = {
        "level": self.config.logging.level,
        "what": self.config.logging.what.split(",")
    }

    self.getDev = function (devId) {
        return self.controller.devices.get(devId);
    };

    self.getVDev = function (aSwitch, event) {
        if (event == "start") {
            return aSwitch.startScene ? self.getDev(aSwitch.startScene) : self.getDev(aSwitch.device);
        } else {
            return aSwitch.endScene ? self.getDev(aSwitch.endScene) : self.getDev(aSwitch.device);
        }
    }

    self.startAction = function () {
        this.action("start");
    }

    self.endAction = function () {
        this.action("end");
    }

    // Create base configuration for timetable entries and their switches
    var entryNum = 1;
    self.entries = self.config.timetable.reduce(function (memo, entry) {
        var config = (entry.config == undefined || entry.config.trim().length == 0) ? {} : self.parseEntryConfig(entry.config);
        self.logDetail("init", "entryNum="+memo.length);
        var switches = self.config.switches.reduce(function (sMemo, aSwitch) {
            var curSwitch = aSwitch[aSwitch.filter];
            var vDevStart = self.getVDev(curSwitch, "start");
            var vDevEnd = self.getVDev(curSwitch, "end");
            var sw = {
                "type": aSwitch.filter,
                "aSwitch": curSwitch,
                "startTitle": vDevStart.get("metrics:title"),
                "endTitle": vDevEnd.get("metrics:title"),
            };
            self.logDetail("init", "Switch", "startTitle=" + sw.startTitle, "ref="+curSwitch.ref);
            if (!("Switches" in config) || _.contains(config.Switches, curSwitch.ref)
                || _.contains(config.Switches, sw.startTitle)) {
                sMemo.push(sw);
                self.logDetail("init", "adding switch " + sw.startTitle);
            } else {
                self.logDetail("init", "not adding switch", sw.startTitle);
            }
            return sMemo;
        }, []);
        memo.push({"config": config, "switches": switches, "entry": entry, "num": entryNum++});
        return memo;
    }, []);

    self.lastPresence = self.getPresenceMode();

    self.presenceChange = _.bind(self.presenceChange, self);
    self.startAction = _.bind(self.startAction, self);
    self.endAction = _.bind(self.endAction, self);

    // Setup event listeners
    _.each(self.presenceModes, function (presenceMode) {
        self.controller.on("presence." + presenceMode, self.presenceChange);
    });

    self.controller.on(self.cronName + ".start", self.startAction);
    self.controller.on(self.cronName + ".end", self.endAction);
    self.times = self.calculateSchedule();

    self.addCronTasks();
};

TabularScheduler.prototype.stop = function () {
    var self = this;

    self.debug("stop entered");
    if (!self.entries) return;
    self.removeCronTasks();

    // Remove event listeners
    self.controller.off(self.cronName + ".start", self.startAction);
    self.controller.off(self.cronName + ".end", self.endAction);

    _.each(self.presenceModes, function (presenceMode) {
        self.controller.off("presence." + presenceMode, self.presenceChange);
    });

    TabularScheduler.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

TabularScheduler.prototype.addCronTasks = function () {
    var self = this;

    var numActive = 0;
    self.times.forEach(function (entry) {
        if (entry.active) {
            numActive++;
            entry.switches.forEach(function (aSwitch) {
                if (aSwitch.start != null) {
                    self.controller.emit("cron.addTask", self.cronName + ".start", {
                            minute: aSwitch.start.getMinutes(),
                            hour: aSwitch.start.getHours(),
                            weekDay: null,
                            day: null,
                            month: null
                        },
                        "extra parameter"
                    );
                    self.debug("Start scheduled for: " + aSwitch.start.getHours() + ":" + aSwitch.start.getMinutes());
                }

                if (aSwitch.end != null) {
                    self.controller.emit("cron.addTask", self.cronName + ".end", {
                            minute: aSwitch.end.getMinutes(),
                            hour: aSwitch.end.getHours(),
                            weekDay: null,
                            day: null,
                            month: null
                        }
                    );
                    self.debug("End scheduled for: " + aSwitch.end.getHours() + ":" + aSwitch.end.getMinutes());
                }
            })
        }
    });
};

TabularScheduler.prototype.removeCronTasks = function () {
    var self = this;

    self.times.forEach(function (time) {
        if (time.active) {
            self.controller.emit("cron.removeTask", self.cronName + ".start");
            self.controller.emit("cron.removeTask", self.cronName + ".end");
            return;
        }
    });
};

TabularScheduler.prototype.validStartDay = function(entry, date) {
    var self = this;
    return ("Days" in entry.config) ? _.contains(entry.config.Days, date.getDay())
        : _.contains(self.dayCheck[entry.entry.days], date.getDay());
};

// Call due cron event, event is start or end
TabularScheduler.prototype.action = function (event) {
    var self = this;

    var updateCron = false;
    var now = self.now();
    self.logDetail(event, self.times.length + " entries to consider");
    self.times.forEach(function (entry, entryNum) {
        self.logDetail(event, "#" + (entryNum+1), "active=" + entry.active, "day=" + now.getDay());
        var process = entry.active;
        if (process && event == "start") {
            process = self.validStartDay(entry, now);
            if(process) self.logDetail(event, "Day is valid for entry");
        }
        if (process) {
            self.logDetail(event, "Num switches to consider=" + entry.switches.length);
            entry.switches.forEach(function (tSwitch, switchNum) {
                var recalcForSwitch = false;
                var processSwitch = tSwitch[event] != null && tSwitch[event] <= now;
                processSwitch = (event == "end") ? processSwitch : processSwitch && !tSwitch.triggered;
                self.logDetail(event, "processSwitch="+processSwitch, event+'Suspended='+tSwitch[event+'Suspended'],
                               "switch time="+self.shortDateTime(tSwitch[event]),
                               "switch triggered="+tSwitch.triggered,
                               "tSwitch[event] != null: " + tSwitch[event] != null,
                               "tSwitch[event] <= now: " + tSwitch[event] <= now);
                var mSwitch = tSwitch.metaSwitch;
                var aSwitch = mSwitch.aSwitch;
                var vDev = self.getVDev(aSwitch, event);
                if (processSwitch && !tSwitch[event+'Suspended']) {
                    var swRef = "'" + mSwitch[event + "Title"] + "' (" + vDev.id + ")";
                    var swMsg;
                    self.logDetail(event, "switch " + swRef, "triggered=" + tSwitch.triggered,
                        "startSuspended=" + tSwitch.startSuspended, "start=" + self.shortDateTime(tSwitch.start),
                        "end=" + self.shortDateTime(tSwitch.end));
                    if (!!vDev) {
                        if (mSwitch.type === 'switchBinary') {
                            var onOff = (event == "start") ? 'on' : 'off';
                            vDev.performCommand(onOff);
                            swMsg = "turning " + onOff;
                        } else if (mSwitch.type === 'switchMultilevel') {
                            vDev.performCommand("exact", {level: aSwitch[event + "Level"]});
                            swMsg = "set level to " + aSwitch[event + "Level"];
                        } else if (mSwitch.type === 'toggleButton') {
                            vDev.performCommand('on');
                            swMsg = "turn on scene";
                        } else {
                            self.error("Don't know how to talk to device type " + mSwitch.type);
                        }
                        self.logSummary(event, "#" + (entryNum+1) + " " + swMsg + " " + swRef);
                    }
                    if (event == "start") {
                        tSwitch.triggered = true;
                        tSwitch.endSuspended = false;
                        recalcForSwitch = tSwitch.end == null;
                    } else {
                        tSwitch.endSuspended = true;
                    }
                }
                if (processSwitch && event == "end") {
                    recalcForSwitch = true;
                }
                if (recalcForSwitch) {
                    entry.switches[switchNum] =
                        self.calculateScheduleEntry4Switch(self.entries[entryNum], mSwitch, true);
                    updateCron = true;
                }
            });
        }
    });
    if (updateCron) {
        self.removeCronTasks();
        self.addCronTasks();
    }
};

TabularScheduler.prototype.presenceChange = function () {
    var self = this;

    self.logDetail("scheduling", "presenceChange", "from", self.lastPresence, "to", self.getPresenceMode());

    var newPresence = self.getPresenceMode();

    // Don't care about change to/from night/home
    if ((self.lastPresence == newPresence ||
         self.lastPresence == 'home' && newPresence == 'night') ||
         self.lastPresence == 'night' && newPresence == 'home') {
    } else {

        self.logDetail("scheduling", "presenceChange about to re-schedule");

        self.calculateSchedule();
        self.removeCronTasks();
        self.addCronTasks();
    }
    self.lastPresence = newPresence;
}

TabularScheduler.prototype.calculateSchedule = function () {
    var self = this;

    var times = [];
    // Get the schedule information
    self.entries.forEach(function (metaEntry) {
        var entry = metaEntry.entry;
        var active = entry.presence === "any" || entry.presence === self.lastPresence;
        var entryTimes = {
            "entry": entry,
            "active": active,
            "days": entry.days,
            "switches": metaEntry.switches.reduce(function (memo, metaSwitch) {
                return memo.concat(self.calculateScheduleEntry4Switch(metaEntry, metaSwitch, active));
            }, []),
            "config": metaEntry.config
        };
        times.push(entryTimes);
    });
    self.logDetail("scheduling", "calculated schedule for " + times.length + " entries");

    self.debug("calculateSchedule exiting", "times", times);

    return times;
};

TabularScheduler.prototype.calculateScheduleEntry4Switch = function (metaEntry, metaSwitch, active) {
    var self = this;
    var entry = metaEntry.entry;
    var switchTime = {
        "triggered": false,
        "metaSwitch": metaSwitch,
        "start": null,
        "end": null
    };

    if (!active) {
        return switchTime;
    }

    ["start", "end"].forEach(function (event) {
        switchTime[event] = self.getTime(entry[event + 'Type'], entry[event + 'Time']);

        if (switchTime[event] != null) {
            if (entry.randomise == "yes" && self.config[event + "Rand"].randType) {
                switchTime[event] = self.randomlyAdjTime(self.config[event + "Rand"].randType,
                    self.config[event + "Rand"].maxAdj, switchTime[event]);
            }

            if (event == "end") {
                switchTime.startSuspended = switchTime.start >= switchTime.end;
                if (switchTime.startSuspended) {
                    var prevDayStartTime = new Date(switchTime.start.getTime());
                    prevDayStartTime.setHours(prevDayStartTime.getHours()-24);
                    switchTime.endSuspended = !self.validStartDay(metaEntry, prevDayStartTime);
                } else {
                    switchTime.endSuspended = true; // End suspended until start has run, TODO: why have triggered as well?
                }
                self.logDetail("scheduling", "switch " + metaSwitch[event+"Title"], "startSuspended=" + switchTime.startSuspended,
                    "endSuspended=" + switchTime.endSuspended, "triggered=" + switchTime.triggered);
            }
        }

    });

    if (entry["startType"] != "none") {
        self.logSummary("scheduling", "#" + metaEntry.num,
            "scheduled switch '" + metaSwitch["startTitle"] + "'",
            self.validStartDay(metaEntry, switchTime["start"])
                ? self.shortDateTime(switchTime["start"]) + "->" + self.shortDateTime(switchTime["end"])
                : "re-schedule " + self.shortDateTime(switchTime["end"]));
        }

    return switchTime;
};

TabularScheduler.prototype.now = function () {
    return new Date(); // Can be overridden for testing
};


TabularScheduler.prototype.getTime = function (type, timeAdjust) {
    var self = this;

    if (type == "none") {
        self.debug("getTime", "type=none");
        return null;
    }

    var timeAdjustArr = timeAdjust.split(":");
    var hours = timeAdjustArr[0];
    var mins = timeAdjustArr[1];
    var timeAdj = hours * 60 * 60 * 1000 + mins * 60 * 1000;
    var now = self.now();
    now.setSeconds(0);
    now.setMilliseconds(0);
    var time = new Date(now);
    switch (type) {
        case "time":
            time.setHours(hours, mins);
            break;
        case "sunsetPlus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunsetMinus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() - timeAdj);
            break;
        case "sunrisePlus":
            time.setTime(self.getSunrise());
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunriseMinus":
            time.setTime(self.getSunrise());
            time.setTime(time.getTime() - timeAdj);
            break;
        default:
            self.error("Unknown time type: " + startType);
    }
    time.setSeconds(0,0); // Cron module only goes down to minutes
    self.debug("getTime time set to ", time, " now=", now);
    if (time.getTime() <= now.getTime()) {
        time.setHours(time.getHours() + 24);
        self.debug("getTime moving forward 24 hours to", time);
        if (type === 'time') { // TODO: really not valid for other types?
            // Correct for DST
            time.setHours(hours, mins);
        }
    }
    return time;
};

TabularScheduler.prototype.randomlyAdjTime = function (type, timeAdjust, baseTime) {
    var self = this;

    var timeAdjustArr = timeAdjust.split(":");
    var hours = timeAdjustArr[0];
    var mins = timeAdjustArr[1];
    var maxAdjMs = hours * 60 * 60 * 1000 + mins * 60 * 1000;
    var randAdjMs;
    switch (type) {
        case "evenDown":
            randAdjMs = _.random(-maxAdjMs, 0);
            break;
        case "evenUp":
            randAdjMs = _.random(0, maxAdjMs);
            break;
        case "evenUpDown":
            randAdjMs = _.random(-maxAdjMs, maxAdjMs);
            break;
        default:
            self.error("Unknown randomise type " + type);
    }
    self.debug("randomlyAdjTime", type,  "adj="+randAdjMs);
    var adjDate = new Date(baseTime.getTime() + randAdjMs);
    // Zero second and ms as cron granularity is only to minutes
    adjDate.setSeconds(0);
    adjDate.setMilliseconds(0);
    return adjDate
};

TabularScheduler.prototype.parseEntryConfig = function (config) {
    var self = this;

    var res;
    switch (true) {
        case /"[^"]+":/.test(config):
            res = JSON.parse(config);
            break;
        case /:/.test(config):
            res = config.match(/[A-Za-z]+:[^:]+($| +)/g)
                .map(function (grp) {
                    return _.rest(/([A-Za-z]+): *(.*)/.exec(grp))
                })
                .reduce(function (memo, grp) {
                    memo[grp[0]] = grp[1].split(",").map(function (item) {
                        return item.trim()
                    });
                    return memo;
                }, {});
            break;
        default:
            return {
                "Switches": config.split(",").map(function (item) {
                    return item.trim()
                })
            };
            break;
    }
    // Expand abbreviations
    res = _.keys(res).reduce(function (memo, key) {
        var newKey = self.abbrevs[key] || key;
        memo[newKey] = res[key];
        return memo;
    }, {});

    // Day name to day number
    if ("Days" in res) {
        res.Days = res.Days.map(function (day) {
            return day in self.dayMap ? self.dayMap[day] : day;
        });
    }
    return res;
}

TabularScheduler.prototype.getSunset = function () {
    var self = this;
    return self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunset');
};

TabularScheduler.prototype.getSunrise = function () {
    var self = this;
    return self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunrise');
};

TabularScheduler.prototype.shortDateTime = function(date) {
    self = this;
    return self.days[date.getDay()] + " " + date.getDate() + "-" + self.months[date.getMonth()] + " " +
        ('00'+date.getHours()).slice(-2) + ":" + ('00'+date.getMinutes()).slice(-2) + " " +
        "TZ:" + date.getTimezoneOffset()/60;
}

TabularScheduler.prototype.logSummary = function (what) {
    var self = this;
    if (!!self.logging.level && _.contains(self.logging.what, what)) {
        self.log(_.reduce(arguments, function (a, b) {
            return a + " " + b
        }, "Summary"));
    }
}

TabularScheduler.prototype.logDetail = function (what) {
    var self = this;
    if (!!self.logging.level && self.logging.level == "detailed" && _.contains(self.logging.what, what)) {
        self.log(_.reduce(arguments, function (a, b) {
            return a + " " + b
        }, "Detail"));
    }
}

TabularScheduler.prototype.debug = function () {
    var self = this;
    //self.log(_.reduce(arguments, function(a,b) {return a + " " + JSON.stringify(b)}));
};
