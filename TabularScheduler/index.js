/*** Tabular Z-Way HA module *******************************************

 Version: 0.0.3
 (c) John Talintyre, 2017
 -----------------------------------------------------------------------------
 -----------------------------------------------------------------------------
 Author: John Talintyre

 Description: A table of start/end times, with criteria including: presence,
 sunrise/sunset with offset, day of week.  Entries can have their times
 randomised.  Add sensors ...

 Uses BaseModule and Astronomy by Maroš Kollár <maros@k-1.com>
 Also takes ideas/code from his MotionTrigger module, see https://github.com/maros/Zway-MotionTrigger
 ******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function TabularScheduler(id, controller) {
    // Call super-constructor first (AutomationModule)
    TabularScheduler.super_.call(this, id, controller);

    this.cronName = undefined;
    this.callbackPresence = undefined;
    this.callbackSensor = undefined;
    this.callbackLight = undefined;
    this.callbackStart = undefined;
    this.callbackEnd = undefined;
    this.callbackActiveHours = undefined;

    this.sensors = undefined;
    this.lights = undefined;
    this.schedule = undefined;
    this.scheduled = undefined;
    this.activeHours = undefined;
}

inherits(TabularScheduler, BaseModule);

_module = TabularScheduler;

/*
TODO: complete move to en.json
TODO: improve description
TODO: randomized entries don't always move to next day when re-scheduled, make sure day changes?
TODO: implement config for sensors (just day left to check)

TODO: Randomisation
   change amount to minutes - I found I'd set 15 mins as 15:00!
   check end as after start before applying randomisation
   check again after randomisation - if start is now after end, log this explicitly as well as mark item as not active
   in detail debug mode - save times before randomisation as well as after

How start/end are triggered
  Check the times against recorded times in self.scheduled
     note per entry/switch when each start time is triggered
     when end time has triggered for an entry/switch then reschedule if needed


How security sensor works
   If any light is on then no effect
   If no light on and in active period
       Switch on all lights
       Set timeout
   If light triggered on then reset timeout
 */

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

TabularScheduler.prototype.init = function (config) {
    // noinspection JSPotentiallyInvalidConstructorUsage
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
    self.fmt = new Format();

    self.debug1("init","config:" + config);

    self.getDev = function (devId) {
        var self = this;
        return self.controller.devices.get(devId);
    };

    self.handleStart = function () {
        this.scheduledEvent("start");
    };

    self.handleEnd = function () {
        this.scheduledEvent("end");
    };

    if (!self.rerunableInit(true)) {
        var wait = 12;
        self.info("init: devices not all initialised when starting. Wait for {}secs", wait);
        // Wait to do rest of initialization to ensure devices are setup and so can refer to their names
        setTimeout(_.bind(self.rerunableInit, self, false), wait*1000);
    }
};

TabularScheduler.prototype.rerunableInit = function(firstRun) {
    var self = this;

    self.debug1("rerunableInit self.config.switches", self.config.switches);


    if (firstRun) {
        self.lights = {
            "byDevice": undefined,
            "changeLights": function(lights, event, source) {
                // Returns number turned on
                return _.reduce(lights, function (numTurnedOn, light) {
                    numTurnedOn += light.changeLight(event, source) == 'turnedOn' ? 1 : 0;
                    return numTurnedOn;
                }, 0);
            }
        };
    }

    self.lights.byDevice = {};
    // Get switch devices so we can keep track of their status
    for (var i=0; i<self.config.switches.length; i++) {
        var cfgSwitch = self.config.switches[i];
        var curSwitch = cfgSwitch[cfgSwitch.filter];
        var device = curSwitch.device;
        self.debug1("rerunableInit device", device);
        var vDev = self.getDev(device);
        if (!vDev) {
            if (firstRun) {
                self.lights.byDevice = undefined;
                return false;
            } else {
                self.error("Missing details of vDev for device " + device + " on init even after waiting with a timeout");
            }
        }
        light = {
            "type": cfgSwitch.filter,
            "device": device,
            "num": i+1,
            "title": vDev.get("metrics:title"),
            "ref": curSwitch.ref,
            "onStatus": undefined,
            "onBy": undefined,
            "startLevel": undefined,
            "endLevel": undefined,
            "tabular": self,
            "getDev": function() {
                var self = this;
                return self.tabular.getDev(self.device);
            },
            "toJSON": function () {
                // Avoid circular dependency when using JSON.stringify
                return _.omit(this, ["tabular"]);
            },
            "getRef": function() {
                return '#' + this.num + ' ' + (!!this.ref ? this.ref : this.title) + '/' + this.device;
            },
            "changeLight": function (event, source) {
                var self = this;
                if (!!self.device) {
                    if (source === 'sensor' && event === 'end' && self.onBy === 'schedule') {
                        return '';
                    }
                    // TODO: have different modes - only turn on light if already on, check light before turning on, always turn on
                    // Record source turning light on, so don't turn off light after sensor off if we've hit light scheduled start
                    if (event === 'start') {
                        if (self.onBy !== 'schedule') self.onBy = source;
                    } else {
                        self.onBy = undefined;
                    }
                    if (self.type === 'switchBinary') {
                        var onOff = (event === "start") ? 'on' : 'off';
                        self.getDev().performCommand(onOff);
                        lightMsg = "turning " + onOff;
                    } else if (self.type === 'switchMultilevel') {
                        self.getDev().performCommand("exact", {level: self[event + "Level"]});
                        lightMsg = "set level to " + self[event + "Level"];
                    } else {
                        tabular.error("Don't know how to talk to device type " + self.type);
                    }
                    self.tabular.summary("changeLight due to {}:{} {} {}", source, event, self.getRef(), lightMsg);
                    return (event === "start") ? 'turnedOn' : 'turnedOff';
                }
                return '';
            }
        };
        if (light.type === 'switchMultilevel') {
            light.startLevel = curSwitch.startLevel;
            light.endLevel = curSwitch.endLevel;
        }
        self.lights.byDevice[device] = light;
        self.setOnStatus(vDev, light);
    }
    self.debug1("rerunableInit lights.byDevice", self.lights.byDevice);

    // Create base configuration for timetable entries and their switches/lights
    self.schedule = self.config.timetable.reduce(function (schedule, timetableRow) {
        self.debug("Init for timetable entry #{}", schedule.length+1);
        var config = (timetableRow.config === undefined || timetableRow.config.trim().length === 0) ? {} : self.parseEntryConfig(timetableRow.config);
        var lights = self.getLightsMatchingConfig(config);
        var scheduleEntry = {
            "config": config,
            "lights": lights,
            "presence": timetableRow.presence,
            "days": timetableRow.days,
            "startTime": timetableRow.startTime,
            "endTime": timetableRow.endTime,
            "randomise": timetableRow.randomise,
            "num": schedule.length + 1
        };
        if (scheduleEntry.lights.length === 0)
            self.summary("   No lights picked for config {}, expanded as: {:S})",
                timetableRow.config, scheduleEntry.config);
        self.debug("init: added schedule entry {:S}", scheduleEntry);
        schedule.push(scheduleEntry);
        return schedule;
    }, []);

    self.lastPresence = self.getPresenceModeIgnoreNight();


    self.callbackPresence = _.bind(self.handlePresence, self);
    self.callbackStart = _.bind(self.handleStart, self);
    self.callbackEnd = _.bind(self.handleEnd, self);
    self.callbackActiveHoursEnd = _.bind(self.handleActiveHours, self);
    self.callbackSensor = _.bind(self.handleSensor,self);
    self.callbackLight = _.bind(self.handleLight, self);

    // Setup event listeners
    _.each(self.presenceModes, function (presenceMode) {
        self.controller.on("presence." + presenceMode, self.callbackPresence);
    });
    self.controller.on(self.cronName + ".start", self.callbackStart);
    self.controller.on(self.cronName + ".end", self.callbackEnd);
    if (self.config.activeHours.set) {
        self.activeHours = self.getActiveHours();
        self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
        self.controller.on(self.cronName + ".activeHours", self.callbackActiveHours);
        self.controller.emit("cron.addTask", self.cronName + ".activeHours",
            {minute: self.activeHours.end.getMinutes()+1,
                hour:   self.activeHours.end.getHours(),
                weekDay: null, day: null, month: null});
    } else {
        self.activeHours = undefined;
    }
    self.scheduled = self.calculateSchedule();

    self.addEventCronTasks();

    if (self.config.sensorTrigger.set) {
        var timeArray = self.config.sensorTrigger.timeout.split(':');
        var config = (self.config.sensorTrigger.config === undefined || self.config.sensorTrigger.config.trim().length === 0)
            ? {} : self.parseEntryConfig(self.config.sensorTrigger.config);
        self.sensors = {
            "timeoutSecs": 60*60*timeArray[0] + 60*timeArray[1] + 1*timeArray[2],
            "triggered": false,
            "config": config,
            "lights": self.getLightsMatchingConfig(config)
        };
        if (self.sensors.lights.length === 0)
            self.summary("   No lights picked for sensor config {}, expanded as: {:S})",
                self.config.sensorTrigger.config, self.sensors.config);

        self.processDeviceList(self.config.sensorTrigger.sensors, function (vDev) {
            self.debug1("initCallback securitySensors callbackSensor(deviceObject)", vDev);
            vDev.on('modify:metrics:level', self.callbackSensor);
        });
    }

    self.processDeviceList(_.map(self.lights.byDevice, function(light) { return light.getDev(); }), function (vDev) {
        self.debug1("initCallback lights callbackLight(deviceObject.on", vDev.id, ")");
        vDev.on('modify:metrics:level', self.callbackLight);
    });

    return true;
};

TabularScheduler.prototype.stop = function () {
    var self = this;

    self.debug1("stop entered");
    if (!self.schedule) return;
    self.removeEventCronTasks();
    self.controller.emit("cron.removeTask", self.cronName + ".activeHours");

    // Remove event listeners
    self.controller.off(self.cronName + ".end", self.callbackEnd);
    self.controller.off(self.cronName + ".start", self.callbackStart);
    self.controller.off(self.cronName + ".activeHours", self.callbackActiveHours);

    self.processDeviceList(_.map(self.lights.byDevice, function(light) { return light.getDev(); }), function (vDev) {
        vDev.off('modify:metrics:level', self.callbackLight);
    });

    if (self.config.sensorTrigger.set) {
        self.processDeviceList(self.config.sensorTrigger.sensors, function (vDev) {
            vDev.off('modify:metrics:level', self.callbackSensor);
        });
    }

    _.each(self.presenceModes, function (presenceMode) {
        self.controller.off("presence." + presenceMode, self.callbackPresence);
    });

    this.callbackPresence = undefined;
    this.callbackSensor = undefined;
    this.callbackLight = undefined;
    this.callbackStart = undefined;
    this.callbackEnd = undefined;
    this.callbackActiveHours = undefined;

    // noinspection JSPotentiallyInvalidConstructorUsage
    TabularScheduler.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

TabularScheduler.prototype.addEventCronTasks = function () {
    var self = this;

    var numActive = 0;
    self.scheduled.forEach(function (scheduledEntry) {
        if (scheduledEntry.active) {
            numActive++;
            scheduledEntry.scheduledLights.forEach(function (scheduledLight) {
                if (scheduledLight.start != null) {
                    self.controller.emit("cron.addTask", self.cronName + ".start", {
                            minute: scheduledLight.start.getMinutes(),
                            hour: scheduledLight.start.getHours(),
                            weekDay: null,
                            day: null,
                            month: null
                        },
                        "extra parameter"
                    );
                    self.debug1("Start scheduled for: " + scheduledLight.start.getHours() + ":" + scheduledLight.start.getMinutes());
                }

                if (scheduledLight.end != null) {
                    self.controller.emit("cron.addTask", self.cronName + ".end", {
                            minute: scheduledLight.end.getMinutes(),
                            hour: scheduledLight.end.getHours(),
                            weekDay: null,
                            day: null,
                            month: null
                        }
                    );
                    self.debug1("End scheduled for: " + scheduledLight.end.getHours() + ":" + scheduledLight.end.getMinutes());
                }
            })
        }
    });
};

TabularScheduler.prototype.removeEventCronTasks = function () {
    var self = this;

    self.scheduled.forEach(function (time) {
        if (time.active) {
            self.controller.emit("cron.removeTask", self.cronName + ".start");
            self.controller.emit("cron.removeTask", self.cronName + ".end");
        }
    });
};


TabularScheduler.prototype.validStartDay = function(scheduledEntry, date) {
    var self = this;
    return ("Days" in scheduledEntry.config) ? _.contains(scheduledEntry.config.Days, date.getDay())
        : _.contains(self.dayCheck[scheduledEntry.days], date.getDay());
};

// Call due to cron event, event is start or end
TabularScheduler.prototype.scheduledEvent = function (event) {
    var self = this;

    var updateCron = false;
    var now = self.now();
    self.info("Event for {} time, {} entries to consider.  Current day is {:EEE}", event, self.scheduled.length, now);
    self.scheduled.forEach(function (scheduledEntry, entryNum) {
        self.info("   Entry #{} with active {}", entryNum+1, scheduledEntry.active);
        var process = scheduledEntry.active;
        if (process && event === "start") {
            process = self.validStartDay(scheduledEntry, now);
            if(process) self.info("   Entry for {} has valid day to be triggered", event);
        }
        if (process) {
            self.info("   Entry has {} light(s) to consider", scheduledEntry.scheduledLights.length);
            scheduledEntry.scheduledLights.forEach(function (scheduledLight, lightNum) {
                var processLight = scheduledLight[event] != null && scheduledLight[event] <= now;
                //self.debug("   Light for {:Dt}, {:S}", scheduledLight[event], scheduledLight);
                self.debug1(event, "processSwitch="+processLight, event+'Suspended='+scheduledLight[event+'Suspended'],
                    "switch time="+self.shortDateTime(scheduledLight[event]),
                    "switch triggered="+scheduledLight.triggered,
                    "tSwitch[event] != null: " + scheduledLight[event] != null,
                    "tSwitch[event] <= now: " + scheduledLight[event] <= now);
                var light = scheduledLight.light;
                var vDev = light.getDev();
                if (processLight && (event === "start" && light.onBy !== "schedule" && scheduledLight.turnOnAtStart ||
                    event === "end" && scheduledLight.turnOffAtEnd)) {
                    var swRef = "'" + light.title + "' (" + vDev.id + ")";
                    self.debug1(event, "switch " + swRef, "triggered=" + scheduledLight.triggered,
                        "startSuspended=" + scheduledLight.startSuspended, "start=" + self.shortDateTime(scheduledLight.start),
                        "end=" + self.shortDateTime(scheduledLight.end));
                    light.changeLight(event, "schedule");
                }
                if (processLight && event === "end") {
                    scheduledEntry.scheduledLights[lightNum] =
                        self.calculateScheduledLight(self.schedule[entryNum], light, true, self.activeHours);
                    updateCron = true;
                }
            });
        }
    });
    if (updateCron) {
        self.removeEventCronTasks();
        self.addEventCronTasks();
    }
};

TabularScheduler.prototype.getLightsMatchingConfig = function(config) {
    var self = this;

    var lights = _.reduce(self.lights.byDevice, function (lights, light) {
        var addLight =
            (!("Switches" in config)                           // All lights
                || _.contains(config.Switches, light.ref)         // Light by ref
                || _.contains(config.Switches, light.title)       // Light by title
                || _.reduce(config.Switches, function(memo, sw) { // Light by regexp of title
                    return memo ? memo : new RegExp(sw, "i").test(light.title)}, false));
        self.info("   Init: {}adding light {}", addLight ? '' : 'not ', light.getRef());
        if (addLight) lights.push(light);
        return lights;
    }, []);
    return lights;
};

TabularScheduler.prototype.handlePresence = function () {
    var self = this;

    var newPresence = self.getPresenceModeIgnoreNight();

    if (self.lastPresence !== newPresence) {
        self.summary("Presence change: {} -> {}", self.lastPresence, newPresence);

        self.lastPresence = newPresence;
        self.scheduled = self.calculateSchedule();
        self.removeEventCronTasks();
        self.addEventCronTasks();
    } else {
        self.debug("Presence change event but no change in presence stays as {}", self.lastPresence);
    }
};

TabularScheduler.prototype.handleLight = function(vDev) {
    var self = this;

    self.debug1("handleLight(vDev)", vDev);
    self.setOnStatus(vDev, self.lights.byDevice[vDev.id]);
};

TabularScheduler.prototype.getPresenceModeIgnoreNight = function() {
    var self = this;
    var presence = self.getPresenceMode();
    // Treat home and night (night at home) as the same
    return presence === 'night' ? 'home' : presence;
};

// TODO: make sure this is called at least once a day?
TabularScheduler.prototype.calculateSchedule = function () {
    var self = this;

    var scheduled = [];
    // Get the scheduled information
    self.summary("Calculating schedule for presence {}", self.lastPresence);
    self.schedule.forEach(function (scheduleEntry) {
        var active = scheduleEntry.presence === "any" || scheduleEntry.presence === self.lastPresence ||
            (scheduleEntry.presence === "away" && self.lastPresence === "vacation");
        var scheduledEntry = {
            "entry": scheduleEntry,
            "active": active,
            "days": scheduleEntry.days,
            "scheduledLights": scheduleEntry.lights.reduce(function (memo, light) {
                return memo.concat(self.calculateScheduledLight(scheduleEntry, light, active, self.activeHours));
            }, []),
            "config": scheduleEntry.config
        };
        scheduled.push(scheduledEntry);
    });
    self.debug("   Scheduled: {:S}", scheduled);
    self.info("Calculate schedule completed for {} entries", scheduled.length);

    return scheduled;
};

// TODO: split out the time changing elements for easier testing?

// Restricted active hours e.g. sunset to sunrise
TabularScheduler.prototype.calcTimesWithinActiveHours = function(now, activeHours, period) {
    var self = this;

    var newPeriod = {"start": period.start, "end": period.end};
    var tmpActiveHours = {"start": activeHours.start, "end": activeHours.end};

    if (tmpActiveHours.end < now) tmpActiveHours = self.getActiveHours(); // Shouldn't happen

    if (period.start > tmpActiveHours.end) {
        // Move activePeriod 24 hours
        tmpActiveHours.start = self.moveTime(tmpActiveHours.start, 24);
        tmpActiveHours.end = self.moveTime(tmpActiveHours.end, 24);
    }
    if (period.end < tmpActiveHours.start || period.start > tmpActiveHours.end) {
        newPeriod.start = null;
    } else {
        newPeriod.start = period.start < tmpActiveHours.start ? tmpActiveHours.start : period.start;
        newPeriod.end = period.end > tmpActiveHours.end ? tmpActiveHours.end : period.end;
    }

    self.debug1("calcTimesWithinActiveHours now", now, "activeHours", tmpActiveHours,
        "period", period, "newPeriod", newPeriod);
    return newPeriod;

};

TabularScheduler.prototype.calculateScheduledLight = function (scheduleEntry, light, active, activeHours) {
    var self = this;
    var scheduledLight = {
        "triggered": false,
        "light": light,
        "start": null,
        "end": null,
        "turnOnAtStart": null,
        "turnOffAtEnd": null
    };

    if (!active) {
        return scheduledLight;
    }

    var period = {};
    var now = self.now();

    ["start", "end"].forEach(function (event) {
        period[event] = self.getEventTime('time', scheduleEntry[event + 'Time']);
    });
    if (period.end <= now) {
        period.end = self.moveTime(period.end, 24);
        if (period.start <= now) period.start = self.moveTime(period.start, 24);
    }
    var origStart = period.start;

    // TODO: make use of turnOffAtEnd
    scheduledLight.turnOffAtEnd = self.validStartDay(scheduleEntry, period.start);

    // TODO: below looks a bit overcomplicated
    if (activeHours !== undefined) {
        // TODO: not shift in time when logging
        period = self.calcTimesWithinActiveHours(now, activeHours, period);
    }

    scheduledLight.start = period.start;
    scheduledLight.end = period.end;

    ["start", "end"].forEach(function (event) {
        if (scheduledLight[event] != null) {
            if (scheduleEntry.randomise === "yes" && self.config[event + "Rand"].randType) {
                scheduledLight[event] = self.randomlyAdjTime(self.config[event + "Rand"].randType,
                    self.config[event + "Rand"].maxAdj, scheduledLight[event]);
            }
        }
    });
    // TODO: what if random change moves end to past? will it be recalculated?

    if (scheduledLight.start != null && scheduledLight.start >= scheduledLight.end) scheduledLight.start = null;
    scheduledLight.turnOnAtStart = scheduledLight.start > now;
    self.info("   scheduled light: {}, start suspended: {}, turn off at end: {}, triggered: {}", light.getRef(), scheduledLight.startSuspended,
        scheduledLight.turnOffAtEnd, scheduledLight.triggered);
    self.debug("   scheduled light {:S}", scheduledLight);

    var info = "   Scheduling" + " #" + scheduleEntry.num + " '" + light.getRef() + "'";
    if (scheduledLight.turnOffAtEnd) {
        if (scheduledLight.start === null) {
            self.summary(info + " ({:Dt}) -> {:Dt}", origStart, scheduledLight.end);
        } else {
            self.summary(info + " {start:Dt} -> {end:Dt}", scheduledLight);
        }
    } else {
        self.summary(info + " will re-schedule at {:Dt}", scheduledLight.end);
    }

    return scheduledLight;
};

TabularScheduler.prototype.now = function () {
    return new Date(); // Can be overridden for testing
};

TabularScheduler.prototype.getActiveHours = function() {
    var self = this;

    var activeHoursCfg = self.config.activeHours;
    var activeHours = {
        // TODO: Change way of getting sunrise and sunset
        "start": self.getEventTime(activeHoursCfg.startType, activeHoursCfg.startTime),
        "end": self.getEventTime(activeHoursCfg.endType, activeHoursCfg.endTime)
    };

    // TODO: could a few secs difference break this?
    if (activeHours.end <= self.now()) {
        activeHours.end = self.moveTime(activeHours.end, 24);
    }
    if (activeHours.start > activeHours.end) {
        activeHours.start = self.moveTime(activeHours.start, -24);
    }

    self.debug1("activeHours exit", activeHours);
    return activeHours;
};



TabularScheduler.prototype.getEventTime = function (type, timeAdjust) {
    var self = this;

    if (!timeAdjust) timeAdjust = "00:00";

    var timeAdjustArr = timeAdjust.split(":");
    var hours = timeAdjustArr[0];
    var mins = timeAdjustArr[1];
    var timeAdj = hours * 60 * 60 * 1000 + mins * 60 * 1000;
    var now = self.now();
    var time = new Date(now.getTime());
    self.debug1("getEventTime type " + type + " timeAdjust " + timeAdjust + " now=", now);
    switch (type) {
        case "time":
            time.setHours(hours, mins);
            break;
        case "sunset":
            time.setTime(self.getSunset());
            break;
        case "sunsetPlus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunsetMinus":
            time.setTime(self.getSunset());
            time.setTime(time.getTime() - timeAdj);
            break;
        case "sunrise":
            time.setTime(self.getSunrise);
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
            self.error("Unknown time type: " + type);
            break;

    }

    time.setSeconds(0,0); // Cron module only goes down to minutes
    self.debug1("getEventTime exit", time);
    return time;
};

TabularScheduler.prototype.moveTime = function(time, hours) {
    var self = this;

    var movedTime = new Date(time.getTime());
    var toHour   = time.getHours();
    var toMinute = time.getMinutes();
    movedTime.setHours(toHour + hours);
    // Correct for DST
    movedTime.setHours(toHour, toMinute);
    self.debug1("moveTime  from", time, "to", movedTime);
    return movedTime;
};

TabularScheduler.prototype.randomlyAdjTime = function (type, timeAdjust, baseTime) {
    var self = this;

    if (baseTime == null) return null;

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
    self.debug1("randomlyAdjTime", type,  "adj="+randAdjMs);
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
};

TabularScheduler.prototype.getSunset = function () {
    var self = this;
    var sunset = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunset');
    self.debug1("Sunset", sunset);
    return sunset;
};

TabularScheduler.prototype.getSunrise = function () {
    var self = this;
    var sunrise = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunrise');
    self.debug1("Sunrise", sunrise);
    return sunrise;
};

// TODO: remove
TabularScheduler.prototype.shortDateTime = function(date) {
    return this.fmt.shortDateTimeFormat(date);
};

TabularScheduler.prototype.setOnStatus = function(vDev, light) {
    var self = this;

    var onStatus = false;

    var level = vDev.get("metrics:level");
    if (light.type === 'switchBinary') {
        if (level === 'on') {
            onStatus = true;
        }
    } else if (light.type === 'switchMultilevel') {
        if (level > 0) {
            onStatus = true;
        }
    } else {
        self.error('Unsupported device type ' + light.type);
    }

    light.onStatus = onStatus;
    self.debug1('setOnStatus', light);
};

TabularScheduler.prototype.handleSensor = function(vDev) {
    var self = this;

    var level = vDev.get('metrics:level');
    self.debug1("handleSensor metrics:level", level, "for device", vDev.id);
    if (level !== 'on' && !self.sensors.triggered) return;

    if (level === 'on') {
        if (self.sensors.offTimeout !== undefined) clearTimeout(self.sensors.offTimeout);
        var now = self.now();
        if (self.activeHours === undefined || (now >= self.activeHours.start && now <= self.activeHours.end)) {
            if (self.lights.changeLights(self.sensors.lights, "start", "sensor") > 0) {
                self.sensors.triggered = true;
            }
        }
    } else {
        self.sensors.offTimeout = setTimeout(_.bind(self.handleSensorOffTimeout,self), self.sensors.timeoutSecs*1000);
    }
};

TabularScheduler.prototype.handleSensorOffTimeout = function() {
    var self = this;
    self.lights.changeLights(self.sensors.lights, "end", "sensor");
    self.sensors.triggered = false;
    self.sensors.offTimeout = undefined;
};

TabularScheduler.prototype.handleActiveHours = function() {
    // Re-calculate active hours once a day when we get to a minute after endTime
    var self = this;
    self.activeHours = self.getActiveHours();
    self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
    // TODO: turn off lights that were triggered by sensors or schedule?

    // start and end will normally be based on sunset and sunrise, so change the cron job everyday
    self.controller.emit("cron.removeTask", self.cronName + ".activeHours");
    self.controller.emit("cron.addTask", self.cronName + ".activeHours",
        {   minute: self.activeHours.end.getMinutes()+1,
            hour:   self.activeHours.end.getHours(),
            weekDay: null, day: null, month: null});
};

TabularScheduler.prototype.summary = function() {
    var self = this;
    if (!!self.config.logging) {
        self.log("[S] " + self.fmt.format.apply(self.fmt, arguments));
    }
}

TabularScheduler.prototype.info = function (what) {
    var self = this;
    if (!!self.config.logging && (self.config.logging === 'detailed' || self.config.logging === 'veryDetailed') ) {
        self.log("[I] " + self.fmt.format.apply(self.fmt, arguments));
    }
};

TabularScheduler.prototype.debug = function () {
    var self = this;
    if (!!self.config.logging && self.config.logging === 'veryDetailed') {
        self.log("[D] " + self.fmt.format.apply(self.fmt, arguments));
    }
};

TabularScheduler.prototype.debug1 = function () {
    var self = this;
    if (!!self.config.logging && self.config.logging === 'veryDetailed') {
        self.log(_.reduce(arguments, function (a, b) {
            return a + " " + JSON.stringify(b)
        }));
    }
};

Format = function() {
    this.days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    this.months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
};

Format.prototype.shortDateTimeFormat = function(date) {
    var self = this;
    return date == null ? "-"
        : self.days[date.getDay()] + " " + date.getDate() + "-" + self.months[date.getMonth()] + " " +
        ('00' + date.getHours()).slice(-2) + ":" + ('00' + date.getMinutes()).slice(-2);
};

Format.prototype.dayAndTimeFormat = function(date) {
    return date == null ? "-" : this.days[date.getDay()] + " " + ('00' + date.getHours()).slice(-2) + ":" + ('00' + date.getMinutes()).slice(-2);
};

Format.prototype.format = function() {
    var self = this;
    var formatting = arguments[0];
    if (arguments.length == 1) return formatting;
    if (arguments.length > 1) {
        var isObj = arguments.length === 2 && typeof arguments[1] == 'object';
        var args = isObj //("string" === t || "number" === t)
            ? arguments[1] : Array.prototype.slice.call(arguments, 1);

        var pos = 0;
        return formatting.replace(/\{([^:}]*)(:([^}]+))?\}/g, function (match, p1, p2, p3) {
            var key = p1 === '' ? pos : p1;
            var fmt = p3 === undefined ? '' : p3;
            var val = isObj && !pos && p1 === '' ? args : args[key];
            pos++;
            switch (fmt) {
                case '':   return val;
                case 'Dt': return self.shortDateTimeFormat(val);
                case 'D1': return self.dayAndTimeFormat(val);
                case 'EEE': return self.days[val.getDay()];
                case 'S':  return JSON.stringify(val);
                case 's':  return val.toString();
                case 'T':  return val.constructor.name;
                default:   return val;
            }
        });
    }
};

