var assert = require('assert');
const leftPad = require('left-pad');
var _ = require('underscore-node');


var parse = function(extra) {
    var abbrevs = {"R":"SwitchRefs", "D":"Days"};
    var dayMap = {"Su":0, "Mo":1, "Tu":2, "We":3, "Th":4, "Fr":5, "Sa":6};
    var res;
    switch(true) {
        case /"[^"]+":/.test(extra):
            res = JSON.parse(extra);
            break;
        case /:/.test(extra):
            res = extra.match(/[A-Za-z]+:[^:]+($| +)/g)
                .map(function(grp) {return _.rest(/([A-Za-z]+): *(.*)/.exec(grp))})
                .reduce(function(memo, grp) {
                    memo[grp[0]] = grp[1].split(",").map(function(item) {return item.trim()});
                    return memo;
                }, {});
            break;
        default:
            return {"SwitchRefs": extraStr.split(",").map(function(item) {return item.trim()})};
            break;
    }
    // Expand abbreviations
    res = _.keys(res).reduce(function(memo, key) {
        var newKey = abbrevs[key] || key;
        memo[newKey] = res[key];
        return memo;
    }, {});

    // Day name to day number
    if("Days" in res) {
        res.Days = res.Days.map(function(day) {
           return dayMap[day] || day;
        });
    }
    return res;
}

// Mocha tests using node assert
describe('Extra parsing', function() {
    it('one', function () {
        console.log("one");
    });

    before(function() {
        extra = {
            "SwitchRefs": ["ref1", "ref2"]
        };

        extra2 = {
            "SwitchRefs": ["ref1", "ref2"],
            "Days": [1,3]
        };
    });

    it('Full config', function() {

        extraStr = JSON.stringify(extra);
        console.log(extraStr);

        parsedExtra = JSON.parse(extraStr);
        console.log(parsedExtra);
        assert.deepStrictEqual(parsedExtra, extra, "Should be the same");
    });

    it("List switch refs", function() {
        extraStr = "ref1, ref2";
        x1 = extraStr.split(",").map(function(item) {return item.trim()});
        out = {"SwitchRefs":x1};
        assert.deepStrictEqual(out, extra, "Should be the same");
    });

    it("Reg exp parse a", function() {
        str = "Switch:ref1, ref2 Days:Mo,Th";
        var grp = /[A-Za-z]+:/g;
        var match;
        var grpStart = [];
        while (match = grp.exec(str)) grpStart.push(match.index);
        //grpEnd = {};
        //_.rest(grpStart).forEach(function (start) {grpEnd.push(start-1)})
        var se = _.zip(grpStart,_.union(_.rest(grpStart),[str.length]));
        var config = {};
        console.log(se);
        se.forEach(function(startEnd) {
            console.log(startEnd);
            var item = str.slice(startEnd[0], startEnd[1]);
            console.log(item);
        })
    });

    it("Reg exp parse b", function() {
        str = "Switch:ref1, ref2 Days:Mo,Th";
        var grp = /([A-Za-z]+):([^:]+)($| +)/g;
        var grps = [];
        while (match = grp.exec(str)) grps.push([match[1],match[2]]);
        res = grps.reduce(function(memo, gp) {
            memo[gp[0]] = gp[1].split(",").map(function(item) {return item.trim()});
            return memo;
        }, {});

        console.log("#b#", res);
    });

    it("Reg exp parse c", function() {
        str = "Switch:ref1, ref2 Days:Mo,Th";
        res = str.match(/[A-Za-z]+:[^:]+($| +)/g)
            .map(function(grp) {
                var match = /([A-Za-z]+:) *(.*)/.exec(grp);
                return [match[1],match[2].split(",").map(function(item) {return item.trim()})];
            }).reduce(function(memo, item) {
                memo[item[0]]=item[1];
                return memo;
            }, {});
        console.log("#c#", res);
    });

    it("Reg exp parse d", function() {
        str = "Switch:ref1, ref2 Days:Mo,Th";
        res = str.match(/[A-Za-z]+:[^:]+($| +)/g)
            .map(function(grp) {return _.rest(/([A-Za-z]+): *(.*)/.exec(grp))})
            .reduce(function(memo, grp) {
                memo[grp[0]] = grp[1].split(",").map(function(item) {return item.trim()});
                return memo;
            }, {});
        console.log("#d#", res);
    });

    it ("Test parse variants SwitchRefs", function() {
        assert.deepStrictEqual(parse(JSON.stringify(extra)), extra);
        assert.deepStrictEqual(parse("SwitchRefs:ref1, ref2"), extra);
        assert.deepStrictEqual(parse("R:ref1, ref2"), extra);
        assert.deepStrictEqual(parse("ref1, ref2"), extra);
    });

    it ("Test parse mult keys", function() {
        assert.deepStrictEqual(parse("SwitchRefs:ref1, ref2 Days:Mo,We"), extra2);
    });
});