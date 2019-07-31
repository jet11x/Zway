/*** TabularScheduler Z-Way HA module *******************************************

 Version: 0.0.5
 (c) John Talintyre, 2017-19
 -----------------------------------------------------------------------------
 -----------------------------------------------------------------------------
 Author: John Talintyre

 Description: Schedule several lights with a table where each entry defines.
   - Presence (home, away etc)
   - Randomisation (yes/no)
   - Days to run
   - Start and end time
   - A light

 In addition:
   - Specify active hours - lights can't be on outside this.  Defined based on time or sunrise/sunset
   - Give sensors to control some or all of the lights

 Uses BaseModule, Presence and Astronomy by Maroš Kollár <maros@k-1.com>
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
    this.callbackCron = undefined;

    this.sensors = undefined;
    this.lights = undefined;
    this.schedule = undefined;
    this.scheduled = undefined;

    this.vDev = undefined;
}

inherits(TabularScheduler, BaseModule);

_module = TabularScheduler;

/*
TODO: honour timeout for sensors when re-starting?
TODO: ensure precision kept for times/randomness
TODO: setInterval isn't staying synched, so can easily get lights turning on almost a minute late.
  Switch to using cron every minute and decide if current mechanism to be used for faster polling
TODO: 1 hour too early when going to DST

Also problem that occured on day of DST (happens 1am on 31-Mar
z-way-server.log.2.gz:[2019-03-31 05:37:50.002] [I] [core] [TabularSchedulerScheduler-14] [S]
Active hours: Sun 31-Mar 18:33 -> Mon 1-Apr 05:35
z-way-server.log.2.gz:[2019-03-31 23:00:02.822] [I] [core] [TabularSchedulerScheduler-14] [S]
Scheduling entry #1 'Light/1 Front Light/ZWayVDev_zway_5-0-37' Mon 1-Apr 12:00->- to Mon 1-Apr 23:00->Mon 1-Apr 23:00
Why no start time?

How start/end are triggered
  Check the times against recorded times in self.scheduled
     note per entry/switch when each start time is triggered
     when end time has triggered for an entry/switch then reschedule if needed
TODO: improve this description

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
    self.activeHours = undefined;

    // Create vdev
    self.vDev = this.controller.devices.create({
        deviceId: "TabularScheduler_" + self.id,
        defaults: {
            metrics: {
                level: 'off',
                sensorsTriggered: false,
                onBySchedule: 0,
                title: self.getInstanceTitle(),
                icon: self.imagePath + '/icon-out-of-hours.png'
            }
        },
        overlay: {
            probeType: 'controller_tabularScheduler',
            deviceType: 'sensorBinary'
        },
        doUpdateNum: function(metric, increment) {
            var num = this.get('metrics:' + metric);
            this.doUpdate(metric, num);
        },
        doUpdate: function(metric , value) {
            this.set('metrics:'+metric, value);
            if(this.get("metrics:level") === 'off') {
                this.set('metrics:icon', self.imagePath + '/icon-out-of-hours.png');
            } else if (this.get('metrics:sensorsTriggered')) {
                this.set("metrics:icon", self.imagePath + '/icon-lights-on-by-sensor.png');
            } else if (this.get('metrics:onBySchedule') > 0) {
                this.set('metrics:icon', self.imagePath + '/icon-lights-on.png');
            } else {
                this.set('metrics:icon', self.imagePath + '/icon-active-hours.png')
            }
            self.debug("vDev.doUpdate(metric={},value={} vDev:{:S}", metric, value, this);
        },
        moduleId: self.id
    });

    self.fmt = new TabularFormat();

    self.debug("init {:=S}", config);

    self.getDev = function (devId) {
        var self = this;
        return self.controller.devices.get(devId);
    };

    self.rerunableInit(true);
};

TabularScheduler.prototype.rerunableInit = function(firstRun) {
    var self = this;

    self.debug("rerunableInit(firstRun={}) config={:S}}", firstRun, self.config);
    self.tmpTimeoutId = undefined;

    self.lights = {
        byDevice: {},
        deadDevices: [],
        numLights: 0,
        changeLights: function (lights, event, source) {
            // Returns number turned on
            return _.reduce(lights, function (numTurnedOn, light) {
                numTurnedOn += light.changeLight(event, source) == 'turnedOn' ? 1 : 0;
                return numTurnedOn;
            }, 0);
        },
        addOrGet: function (device, sensorLightCheck) {
            if (_.contains(this.deadDevices, device)) return null;
            var light = this.byDevice[device];
            if (light == null) {
                var vDev = self.getDev(device);
                if (!vDev) {
                    this.deadDevices.push(device);
                    return null;
                }
                var light = new TabularLight(device, ++this.numLights, vDev, self);
                light.setOnStatus(vDev);
                this.byDevice[device] = light;
            }
            light.sensorLightCheck = sensorLightCheck;
            return light;
        }
    }


    // Create base configuration for timetable entries and their switches/lights
    var schedule = [];
    for (var i=0; i<self.config.timetable.length; i++) {
        var timetableRow = self.config.timetable[i];
        self.debug("Init for timetable entry #{}", i+1);
        var device = timetableRow.device;
        var light = self.lights.addOrGet(device, false);
        if (!!light) {
            var scheduleEntry = {
                light: light,
                presence: timetableRow.presence,
                days: self.getDays(timetableRow.days),
                startTime: timetableRow.startTime,
                endTime: timetableRow.endTime,
                maxRandMs: timetableRow.randomise === 'yes' ? Math.round(self.config.maxRand * 60 * 1000) : 0,
                num: schedule.length + 1
            };
            self.debug("init: added schedule entry {:S}", scheduleEntry);
            schedule.push(scheduleEntry);
        }
    }
    self.schedule = schedule;

    self.lastPresence = self.getPresenceModeIgnoreNight();
    self.callbackPresence = _.bind(self.handlePresence, self);
    self.callbackSensor = _.bind(self.handleSensor,self);
    self.callbackLight = _.bind(self.handleLight, self);

    if (self.config.sensorTrigger.set) {
        var sensorLights = [];
        for (var i = 0; i < self.config.sensorTrigger.switches.length; i++) {
            var device = self.config.sensorTrigger.switches[i];
            var light = self.lights.addOrGet(device, self.config.sensorTrigger.lightCheck);
            if (!!light) sensorLights.push(light);
        }
    }

    if (self.lights.deadDevices.length > 0) {
        if (firstRun) {
            var wait = 12;
            self.info("init: devices not all initialised when starting. Wait for {} secs", wait);
            // Wait to do rest of initialization to ensure devices are setup and so can refer to their names
            self.tmpTimeoutId = setTimeout(_.bind(self.rerunableInit, self, false), wait*1000);
            return;
        } else {
            self.summary("init - {} device(s) not working: {}", self.lights.deadDevices.length,
                self.lights.deadDevices.join(", ")); // TODO: change to error?
        }
    }

    if (self.config.sensorTrigger.set) {
        if (self.config.sensorTrigger.switches.length === 0) {
            sensorLights = _.map(_.values(self.lights.byDevice), function(light) {
                light.sensorLightCheck = self.config.sensorTrigger.lightCheck;
                return light;
            });
        }
        self.sensors = {
            "timeoutMillis": Math.round(60*1000*self.config.sensorTrigger.timeout),
            "triggered": false,
            "lights": sensorLights
        };

        self.processDeviceList(self.config.sensorTrigger.sensors, function (vDev) {
            self.debug1("initCallback securitySensors callbackSensor(deviceObject)", vDev);
            vDev.on('modify:metrics:level', self.callbackSensor);
        });
    }

    // Get Astronomy config so SunCalc can be used to find today or tomorrow's sunset/sunrise
    var ast = _.find(self.controller.instances, function(instance) {return instance.moduleId === 'Astronomy'});
    self.longitude = ast.params.longitude;
    self.latitude = ast.params.latitude;

    // Setup event listeners
    _.each(self.presenceModes, function (presenceMode) {
        self.debug("About to call controller.on(presenceMode={})", presenceMode);
        self.controller.on("presence." + presenceMode, self.callbackPresence);
    });

    var now = self.now();
    if (self.config.activeHours.set) {
        self.activeHours = self.calculateActiveHours(self.now(), self.config.activeHours);
        self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
    } else {
        self.activeHours = undefined;
    }
    if (self.activeHours === undefined || (now >= self.activeHours.start && now <= self.activeHours.end)) {
        self.vDev.doUpdate('level', 'on');
    }
    self.scheduled = self.calculateSchedule();

    self.processDeviceList(_.map(self.lights.byDevice, function(light) { return light.getDev(); }), function (vDev) {
            self.debug1("initCallback lights callbackLight(deviceObject.on", vDev.id, ")");
            vDev.on('modify:metrics:level', self.callbackLight);
    });

    self.eventTimes = self.getEventTimes();

    self.info("pollInterval {}", self.config.pollInterval);
    if (self.config.pollInterval == 60) {
        self.info("Using cron to check scheduled times every minute");
        self.callbackCron = _.bind(self.checkEvents, self, false);
        self.controller.on(self.cronName, self.callbackCron);
        // Will get call back every minute - generally very fews seconds into minute which is much
        // better than when using setTimeout with 1 second
        self.controller.emit("cron.addTask", self.cronName,
            {minute: null, hour:   null, weekDay: null, day: null, month: null});
    } else {
        // TODO: this doesn't work, simplify
        // Sync clock e.g. if time is 10:32:20.109 and polling interval is 60 seconds then
        // wait until 10:33:00.000 i.e. for 39.891 seconds before starting polling
        // In practice doesn't work very well
        self.pollIntervalMs = self.config.pollInterval * 1000;
        now = self.now();
        var msIntoMin = now.getSeconds() * 1000 + now.getMilliseconds();
        var waitFor = self.pollIntervalMs - (msIntoMin % self.pollIntervalMs);
        self.info("Will wait {}ms, so polling is synchronised to clock seconds", waitFor);
        self.tmpTimeoutId = setTimeout(function () {
            self.tmpTimeoutId = undefined;
            self.checkEventsId = setInterval(_.bind(self.checkEvents, self, false), self.pollIntervalMs);
            self.info("Synched to clock @{:DD}", self.now());
        }, waitFor);
    }


    return true;
};


TabularScheduler.prototype.stop = function () {
    var self = this;

    self.debug1("stop entered");
    if (!self.schedule) return;

    if (!!self.sensors && !!self.sensors.offTimeout) clearTimeout(self.sensors.offTimeout);
    if (!!self.tmpTimeoutId) clearTimeout(self.tmpTimeoutId);
    if (!!self.checkEventsId) clearInterval(self.checkEventsId);
    if (!!self.callbackCron) {
        self.controller.emit("cron.removeTask", self.cronName);
        self.controller.off(self.cronName, self.callbackCron);
        self.callbackCron = undefined;
    }

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

    if (self.vDev) {
        self.controller.devices.remove(self.vDev.id);
        self.vDev = undefined;
    }

    // noinspection JSPotentiallyInvalidConstructorUsage
    TabularScheduler.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

TabularScheduler.prototype.checkEvents = function() {
    var self = this;

    var now = self.now();
    self.debug("Checking for events @{:DD}", now);
    if (!!self.activeHours) {
        if (self.vDev.get('metrics:level') === 'off') {
            //self.debug("checkEvents not in active hours which are {start:Dt}->{end:Dt}", self.activeHours);
            if (self.activeHours.start <= now) self.handleActiveHoursStart();
        } else {
            if (self.activeHours.end <= now) self.handleActiveHoursEnd();
        }
    }

    if (self.eventTimes.length > 0 && self.eventTimes[0].time <= now) {
        var partitions = _.partition(self.eventTimes, function(eventTime) { return eventTime.time <= now; });
        var futureEvents = partitions[1];
        var rescheduled = [];
        partitions[0].forEach(function(eventTime) {
            var event = eventTime.event;
            var scheduled = eventTime.scheduledEntry;
            var light = scheduled.scheduledLight.light;
            self.debug("checkEvents: {event:=} {scheduledEntry:=S})", eventTime);
            switch(event) {
                case 'start':
                case 'end':
                    light.changeLight(event, "schedule");
                    scheduled.scheduledLight[event] = null; // Don't repeat event
                    break;
                case 'reschedule':
                    scheduled.scheduledLight =
                        self.calculateScheduledLight(scheduled.entry, light, true, self.activeHours);
                    rescheduled.push(self.getEventTimesForEntry(scheduled));
                    break;
            }
        });
        self.eventTimes = _.sortBy(_.union(futureEvents, _.flatten(rescheduled)), 'time');
    }
};

TabularScheduler.prototype.getEventTimesForEntry = function(scheduledEntry) {
    var events = [];
    ['start','end','reschedule'].forEach(function(event) {
        if (scheduledEntry.scheduledLight[event] != null) {
            events.push({
                'scheduledEntry': scheduledEntry,
                'event': event,
                'time': scheduledEntry.scheduledLight[event]
            });
        }
    });
    return events;
}

TabularScheduler.prototype.getEventTimes = function() {
    var self = this;
    return _.sortBy(
            _.reduce(self.scheduled, function(events, scheduledEntry) {
                return scheduledEntry.active ? _.union(events, self.getEventTimesForEntry(scheduledEntry)) : events;
            }, []),
'time');
};

TabularScheduler.prototype.getDays = function(daysStrings) {
   return _.map(
            _.reduce(daysStrings, function(memo, daysString) {
            return _.union(memo, daysString.split(','));
            }, []),
        function(num) {return parseInt(num)});
}

TabularScheduler.prototype.handlePresence = function () {
    var self = this;

    var newPresence = self.getPresenceModeIgnoreNight();

    if (self.lastPresence !== newPresence) {
        self.summary("Presence change: {} -> {}", self.lastPresence, newPresence);

        self.lastPresence = newPresence;
        self.scheduled = self.calculateSchedule();
        self.eventTimes = self.getEventTimes();
    } else {
        self.debug("Presence change event but no change in presence stays as {}", self.lastPresence);
    }
};

TabularScheduler.prototype.handleLight = function(vDev) {
    this.lights.byDevice[vDev.id].setOnStatus(vDev);
};

TabularScheduler.prototype.getPresenceModeIgnoreNight = function() {
    var self = this;
    var presence = self.getPresenceMode();
    // Treat home and night (night at home) as the same
    return presence === 'night' ? 'home' : presence;
};

TabularScheduler.prototype.calculateSchedule = function () {
    var self = this;

    var scheduled = [];
    // Get the scheduled information
    self.summary("Calculating schedule for presence {}", self.lastPresence);
    self.schedule.forEach(function (scheduleEntry) {
        var active = scheduleEntry.presence === "any" || scheduleEntry.presence === self.lastPresence ||
            (scheduleEntry.presence === "away" && self.lastPresence === "vacation");
        var scheduledEntry = {
            entry: scheduleEntry,
            active: active,
            days: scheduleEntry.days, // TODO: needed?
            scheduledLight: self.calculateScheduledLight(scheduleEntry, scheduleEntry.light, active, self.activeHours)
        };
        scheduled.push(scheduledEntry);
    });
    self.debug("   Scheduled: {:S}", scheduled);
    self.info("Calculate schedule completed for {} entries", scheduled.length);

    return scheduled;
};

// Restricted active hours e.g. sunset to sunrise
TabularScheduler.prototype.calcTimesWithinActiveHours = function(now, activeHours, period) {
    var self = this;

    var newPeriod = {"start": period.start, "end": period.end};
    var which = period.start > activeHours.end ? 'next' : '';
    if (period.end < activeHours[which + 'start'] || period.start > activeHours[which + 'end']) {
        newPeriod.start = null;
    } else {
        newPeriod.start = period.start < activeHours[which + 'start'] ? activeHours[which + 'start'] : period.start;
        newPeriod.end = period.end > activeHours[which + 'end'] ? activeHours[which + 'end'] : period.end;
    }

    self.debug("calcTimesWithinActiveHours(now={}, activeHours={:S}, period={:S}) -> {}",
        now, activeHours, period, newPeriod);
    return newPeriod;
};

TabularScheduler.prototype.calculateScheduledLight = function (scheduleEntry, light, active, activeHours) {
    var self = this;
    var scheduledLight = {
        light: light,
        start: null,
        end: null,
        origstart: null,
        origend: null,
        reschedule: null,
        randstart: 0,
        randend: 0
    };

    if (!active) {
        return scheduledLight;
    }

    var period = {};
    var now = self.now();

    ["start", "end"].forEach(function (event) {
        period[event] = self.getEventTime('time', now, scheduleEntry[event + 'Time']);
        scheduledLight['rand' + event] = _.random(scheduleEntry.maxRandMs) * (event==='end' ? -1 : 1);
    });
    var start = period.start;
    if (period.end <= now) {
        period.end = self.moveTime(period.end, 24);
        if (period.start <= now) period.start = self.moveTime(period.start, 24);
    }
    scheduledLight.origstart = new Date(period.start);
    scheduledLight.origend = new Date(period.end);
    scheduledLight.reschedule = new Date(period.end);

    self.info("      Entry #{} '{}' before adj:     {:Dt}->{:Dt}", scheduleEntry.num, light.getRef(),
        scheduledLight.origstart, scheduledLight.origend);

    self.debug("scheduleEntry.days={:S}", scheduleEntry.days);
    self.debug("scheduledLight {:S}", scheduledLight);
    self.debug(".getDay() -> {}", scheduledLight.origstart.getDay());
    var validStartDay = _.contains(scheduleEntry.days,scheduledLight.origstart.getDay());

    var noStart = null;
    var endComment = "";
    if (activeHours !== undefined) {
        period = self.calcTimesWithinActiveHours(now, activeHours, period);
        if (period.start == null) {
            noStart = "Start is not within active hours";
        } else {
            self.info("      Entry #{} '{}' active hours => {:Dt}->{:Dt}", scheduleEntry.num, light.getRef(),
                period.start, period.end);
        }
    }

    scheduledLight.start = period.start;
    scheduledLight.end = period.end;

    ['start', 'end'].forEach(function (event) {
        if (scheduledLight[event] != null)
            scheduledLight[event].setTime(scheduledLight[event].getTime() + scheduledLight['rand' + event]);
    });
    if (scheduleEntry.maxRandMs !== 0) {
        self.info("      Entry #{} '{}' randomise    => {:Dt}->{:Dt}", scheduleEntry.num, light.getRef(),
            scheduledLight.start, scheduledLight.end);
    }

    if (noStart == null) {
        if (!validStartDay) {
            noStart = self.fmt.format("{:EEE} is not a valid start day", scheduledLight.start);
            scheduledLight.end = null;
        } else if (scheduledLight.start > scheduledLight.end) {
            noStart = "Start after end";
            scheduledLight.end = null;
        } else if (scheduledLight.start.getTime() == scheduledLight.end.getTime()) {
            noStart = "Start same as end";
            scheduledLight.end = null;
        } else if (scheduledLight.start < now) {
            noStart = "Start in the past";
        }
    }

    if (noStart != null) {
        scheduledLight.start = null;
        var endComment = scheduledLight.end == null ? "" : "turn off & ";
        self.summary("   Entry #{} '{}' {}, will {}re-schedule at {:Dt}", scheduleEntry.num, light.getRef(),
            noStart, endComment, scheduledLight.reschedule);
    } else {
        self.summary("   Entry #{} '{}' scheduled for:     {:Dt}->{:Dt}", scheduleEntry.num, light.getRef(),
            scheduledLight.start, scheduledLight.end);
    }
    self.debug("   scheduled light {:S}", scheduledLight);

    return scheduledLight;
};

TabularScheduler.prototype.now = function () {
    return new Date(); // Can be overridden for testing
};

TabularScheduler.prototype.calculateActiveHours = function(now, activeHoursCfg) {
    var self = this;

    var addDays = function(was, days) {
        var is = new Date(was);
        is.setDate(is.getDate()+days);
        // Found need to set hour to 1 to get current day's sunrise/sunset
        is.setHours(1, 0, 1, 0); // TODO: DST?
        return is;
    }

    var beforeActive = now;
    var end   = self.getEventTime(activeHoursCfg.endType, beforeActive, activeHoursCfg.endTime);
    if (end <= now) {
        beforeActive = addDays(beforeActive, 1);
        end = self.getEventTime(activeHoursCfg.endType, beforeActive, activeHoursCfg.endTime);
    }

    var prevDay = addDays(beforeActive, -1);
    var start = self.getEventTime(activeHoursCfg.startType, prevDay, activeHoursCfg.startTime);

    nextstart = self.getEventTime(activeHoursCfg.startType, beforeActive, activeHoursCfg.startTime);
    nextend = self.getEventTime(activeHoursCfg.endType, addDays(beforeActive, 1), activeHoursCfg.endTime);

    return {
        start: start,
        end: end,
        nextstart: nextstart,
        nextend: nextend
    };
}

TabularScheduler.prototype.calcActiveHours = function(now, activeHours, prefix, adjust) {
    var self = this;

    var activeHoursCfg = self.config.activeHours;
    var start = self.getEventTime(activeHoursCfg.startType, now, activeHoursCfg.startTime);
    var end   = self.getEventTime(activeHoursCfg.endType, now, activeHoursCfg.endTime);

    if (!prefix) {
        if (end <= now) end = self.moveTime(end, 24);
        if (start > end) start = self.moveTime(start, -24);
    }

    activeHours[prefix + 'start'] = adjust === 0 ? start : self.moveTime(start, adjust);
    activeHours[prefix + 'end']   = adjust === 0 ? end   : self.moveTime(end, adjust);
    if (activeHours[prefix + 'end'] < activeHours[prefix + 'start']) {
        self.summary("Oops");
        // TODO: temporary
        activeHours[prefix + 'end']   = adjust === 0 ? end   : self.moveTime( activeHours[prefix + 'end'], 24);
    }
}

TabularScheduler.prototype.initActiveHours = function(now) {
    var self = this;
    var activeHours = {};
    self.calcActiveHours(now, activeHours, '', 0);
    activeHours.nextstart = self.moveTime(activeHours.start, 24);
    activeHours.nextend = self.moveTime(activeHours.end, 24);

    self.debug("initActiveHours: {start:Dt}->{end:Dt}", activeHours);
    self.activeHours = activeHours;
};

TabularScheduler.prototype.updateActiveHours = function(now) {
    var self = this;

    var activeHours = {};
    activeHours.start = self.activeHours.nextstart;
    activeHours.end   = self.activeHours.nextend;
    self.calcActiveHours(now, activeHours, 'next', 24);

    self.debug("updateActiveHours: {start:Dt}->{end:Dt}", activeHours);
    self.activeHours = activeHours;
};

TabularScheduler.prototype.getEventTime = function (type, now, timeAdjust) {
    var self = this;

    if (!timeAdjust) timeAdjust = "00:00";

    var timeAdjustArr = timeAdjust.split(":");
    var hours = timeAdjustArr[0];
    var mins = timeAdjustArr[1];
    var timeAdj = hours * 60 * 60 * 1000 + mins * 60 * 1000;
    var time = new Date(now.getTime());
    self.debug1("getEventTime type " + type + " timeAdjust " + timeAdjust + " now=", now);
    switch (type) {
        case "time":
            time.setHours(hours, mins);
            break;
        case "sunset":
            time.setTime(self.getSunset(now));
            break;
        case "sunsetPlus":
            time.setTime(self.getSunset(now));
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunsetMinus":
            time.setTime(self.getSunset(now));
            time.setTime(time.getTime() - timeAdj);
            break;
        case "sunrise":
            time.setTime(self.getSunrise(now));
            break;
        case "sunrisePlus":
            time.setTime(self.getSunrise(now));
            time.setTime(time.getTime() + timeAdj);
            break;
        case "sunriseMinus":
            time.setTime(self.getSunrise(now));
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
    self.debug("moveTime  from {:D1} {:D1}", time, movedTime);
    return movedTime;
};

TabularScheduler.prototype.getSunset = function (now) {
    var self = this;
    var times = SunCalc.getTimes(now, self.latitude, self.longitude);
    return times.sunset;
    /*var sunset = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunset');
    self.debug("getSunset returns {:Dt}", sunset);
    return sunset;*/
};

TabularScheduler.prototype.getSunrise = function (now) {
    var self = this;
    return SunCalc.getTimes(now, self.latitude, self.longitude).sunrise;
    /*var sunrise = self.getDeviceValue([
        ['probeType', '=', 'astronomy_sun_altitude']
    ], 'metrics:sunrise');
    self.debug1("Sunrise", sunrise);
    return sunrise;*/
};

TabularScheduler.prototype.handleSensor = function(vDev) {
    var self = this;

    var level = vDev.get('metrics:level');
    self.debug1("handleSensor metrics:level", level, "for device", vDev.id);
    if (level !== 'on' && !self.sensors.triggered) return;

    if (level === 'on') {
        if (self.sensors.offTimeout !== undefined) clearTimeout(self.sensors.offTimeout);
        if (self.vDev.get('metrics:level') === 'on') {
            if (self.lights.changeLights(self.sensors.lights, "start", "sensor") > 0) {
                self.sensors.triggered = true;
                self.vDev.doUpdate('sensorsTriggered', true);
                // TODO:
                //self.addNotification('info', "sensor Triggered", 'module');  // Puts out blank message
                //self.addNotification('error', "sensor Triggered pretend error", 'module');
                //self.controller.emit(self.cronName + '.sensor.triggered');
            }
        }
    } else {
        self.sensors.offTimeout = setTimeout(_.bind(self.handleSensorOffTimeout,self), self.sensors.timeoutMillis);
    }
};

TabularScheduler.prototype.handleSensorOffTimeout = function() {
    var self = this;
    self.lights.changeLights(self.sensors.lights, "end", "sensor");
    self.vDev.doUpdate("sensorsTriggered", false);
    self.sensors.triggered = false;
    self.sensors.offTimeout = undefined;
};

// TODO: move these two inline
TabularScheduler.prototype.handleActiveHoursStart = function() {
    var self = this;

    self.vDev.doUpdate('level', 'on');
};

TabularScheduler.prototype.handleActiveHoursEnd = function() {
    // Re-calculate active hours once a day when period ends
    var self = this;

    self.activeHours = self.calculateActiveHours(self.now(), self.config.activeHours);
    self.summary("Active hours: {start:Dt} -> {end:Dt}", self.activeHours);
    // TODO: should next day's active hours
    // TODO: turn off lights that were triggered by sensors or schedule?

    self.vDev.doUpdate('level', 'off');
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

TabularLight = function(device, num, vDev, tabular) {
    this.device = device;
    this.num = num;
    this.title = vDev.get("metrics:title");
    this.deviceType = vDev.get("deviceType");
    this.onLevel = tabular.config.onLevel;
    this.onStatus = undefined;
    this.onBy = undefined;
    this.startLevel = undefined;
    this.endLevel = undefined;
    this.sensorLightCheck = undefined;
    this.tabular = tabular;
};

TabularLight.prototype.getDev = function() {
    return this.tabular.getDev(this.device);
};

TabularLight.prototype.toJSON = function () {
    // Avoid circular dependency when using JSON.stringify
    return _.omit(this, ["tabular"]);
};

TabularLight.prototype.getRef = function() {
    return 'Light/' + this.num + ' ' + this.title + '/' + this.device;
};

TabularLight.prototype.setOnStatus = function(vDev) {
    var level = vDev.get("metrics:level");
    this.onStatus = this.deviceType === 'switchMultilevel' ? level > 0 : level === 'on';
};

TabularLight.prototype.changeLight = function (event, source) {
    var self = this;
    if (!!self.device) {
        if (source === 'sensor' && event === 'end' && self.onBy === 'schedule') {
            return '';
        }
        // Record source turning light on, so don't turn off light after sensor off if we've hit light scheduled start
        if (event === 'start') {
            if (self.onBy !== 'schedule') self.onBy = source;
            switch (self.sensorLightCheck) {
                case 'no': break;
                case 'query': self.setOnStatus(self.getDev()); // and then do same check as notification
                case 'notification':
                    if (self.onStatus) return '';
                    break;

            }
            if (source === 'sensor') {
            }
        } else {
            self.onBy = undefined;
        }
        var onOff = (event === "start") ? 'on' : 'off';
        self.onStatus = event === "start";
        if (self.deviceType === 'switchMultilevel') {
            self.getDev().performCommand('exact', { level: onOff === "on" ? self.onLevel : 0 })
        } else {
            self.getDev().performCommand(onOff);
        }

        self.tabular.summary("changeLight due to {}:{} {} turning {}", source, event, self.getRef(), onOff);
        if (source === 'schedule') {
            self.tabular.vDev.doUpdateNum('onBySchedule', event === 'start' ? 1 : -1);
        }
        return (event === "start") ? 'turnedOn' : 'turnedOff';
    }
    return '';
};

TabularFormat = function() {
    this.days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    this.months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
};

TabularFormat.prototype.shortDateTimeFormat = function(date) {
    if (date == null) return '-';
    var self = this;
    return date == null ? "-"
        : self.days[date.getDay()] + " " + date.getDate() + "-" + self.months[date.getMonth()] + " " +
        ('00' + date.getHours()).slice(-2) + ":" + ('00' + date.getMinutes()).slice(-2);
};

TabularFormat.prototype.dayAndTimeFormat = function(date) {
    return date == null ? "-" : this.days[date.getDay()] + " " + ('00' + date.getHours()).slice(-2) + ":" +
        ('00' + date.getMinutes()).slice(-2);
};

TabularFormat.prototype.granulerDayAndTimeFormat = function(date) {
    return date == null ? "-" : this.days[date.getDay()] + " " + ('00' + date.getHours()).slice(-2) + ":" +
        ('00' + date.getMinutes()).slice(-2) + ":" + ('00' + date.getSeconds()).slice(-2) + "." +
        ('000' + date.getMilliseconds()).slice(-3);
};

TabularFormat.prototype.format = function() {
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
            var val = isObj && !pos && p1 === '' ? args : (args == null ? null : args[key]);
            pos++;
            var s = '';
            if (fmt.charAt(0) === '=') {//startsWith('=')) {
                fmt = fmt.slice(1);
                s = key + '=';
            }
            switch (fmt) {
                case '':   return s + val;
                case 'p':  return s + val;
                case 'Dt': return s + self.shortDateTimeFormat(val);
                case 'D1': return s + self.dayAndTimeFormat(val);
                case 'DD': return s + self.granulerDayAndTimeFormat(val);
                case 'EEE': return s + self.days[val.getDay()];
                case 'S':  return s + JSON.stringify(val);
                case 's':  return s + val.toString();
                case 'T':  return s +val.constructor.name;
                default:   return s + val;
            }
        });
    }
};

