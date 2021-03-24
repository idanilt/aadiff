const fs = require('fs');
const path = require('path');
const parser = require('@asyncapi/parser');
const diffText = require("@ads-vdh/md-diff");
const Generator = require("@asyncapi/generator");

async function readAA(file) {
    const dir = path.dirname(file);
    const data = fs.readFileSync(file).toString();
    const p = process.cwd();
    process.chdir(dir);
    const res = await parser.parse(data);
    //process.chdir(p);
    return res;
}

function empty(obj) {
    const ret = {};
    for (let i in obj) {
        if (typeof obj[i] === "object") {
            ret[i] = empty(obj[i]);
        } else {
            ret[i] = "";
        }
    }
    return ret;
}

function tostr(obj) {
    let ret = "";
    for (let i in obj) {
        if (typeof obj[i] === "object") {
            ret += tostr(obj[i]);
        } else {
            ret += "- " + obj[i].toString() + "\n";
        }
    }
    return ret;
}

function compare(f1, f2) {
    if (f1 === f2) {
        return {};
    }
    if ((typeof f1 === "string" && f1.indexOf("anonymous-schema") !== -1) ||
        (typeof f2 === "string" && f2.indexOf("anonymous-schema") !== -1)) {
        return {};
    }
    if (typeof f1 === typeof f2 && typeof f1 === "object" && Array.isArray(f1) === Array.isArray(f2)) {
        const res = {};
        for (let key in {...f1, ...f2}) {
            if ((typeof f1[key] === "object" || typeof f2[key] === "object") && typeof f1[key] !== typeof f2[key]) {
                //console.log(">>>",typeof f1, "<<<", typeof f2)
                if (typeof f1[key] === "object") {
                    f2[key] = empty(f1[key]);
                    //f1 = tostr(f1);
                } else {
                    //f2 = tostr(f2);
                    f1[key] = empty(f2[key]);
                }
                const c = compare(f1[key], f2[key]);
                if (Object.keys(c).length > 0) {
                    res[`<ins>${key}</ins>`] = c;
                }
            } else {
                const c = compare(f1[key], f2[key]);
                if (Object.keys(c).length > 0) {
                    res[key] = c;
                }
            }

        }
        return res;
        //return (Array.isArray(f1) ?
        //{} : //f1.map((_, idx) => compare(f1[idx], f2[idx])) :
        //Object.keys(f1).map((key) => compare(f1[key], f2[key]))).flat();
        //Object.keys({...f1, ...f2}).reduce((acc, val, idx) => ({[val]:compare(f1, f2)}), {}))
    }


    return {
        f1: typeof f1 !== undefined ? f1 : "",
        f2: typeof f2 !== undefined ? f2 : ""
    };
}

function flattenObject(ob) {
    var toReturn = {};

    for (var i in ob) {
        if (!ob.hasOwnProperty(i)) continue;

        if ((typeof ob[i]) == 'object' && ob[i] !== null) {
            var flatObject = flattenObject(ob[i]);
            for (var x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;

                toReturn[i + '.' + x] = flatObject[x];
            }
        } else {
            toReturn[i] = ob[i];
        }
    }
    return toReturn;
}

async function diff(file1, file2) {
    const f1 = (await readAA(file1)).channels();
    const f2 = (await readAA(file2)).channels();
    const change = {
        deleted: {},
        new: {},
        modified: {},
    };

    for (let key in f2) {
        if (!f1[key]) {
            change.new[key] = f2[key].description() || key;
        }
    }
    for (let key in f1) {
        if (!f2[key]) {
            change.deleted[key] = f1[key].description() || key;
        }
    }
    for (let key in change.deleted) {
        delete f1[key];
    }
    for (let key in f1) {
        const c = compare(f1[key]._json, f2[key]._json);
        if (Object.keys(c).length > 0) {
            change.modified[key] = c;
        }
    }


    return change;
    //console.log(JSON.stringify(change,null, 2 ));
    //console.log(f2);
}

// diff('./aas/asyncapi.yaml',
//     'C:\\Users\\idan.levin\\prj\\cdc-automation-api-spec\\aas\\asyncapi.yaml')

const f1 = process.argv[2];
const f2 = process.argv[3];
const fmt = process.argv[4];

function modMd(v, head = "##") {
    let ret = "";
    if (v.f1 || v.f2) {
        if (typeof v.f1 === "undefined") v.f1 = "";
        if (typeof v.f2 === "undefined") v.f2 = "";
        if (typeof v.f1 !== "string") v.f1 = v.f1.toString();
        if (typeof v.f2 !== "string") v.f2 = v.f2.toString();
        const d = diffText(v.f1, v.f2, false).replace(/([#]+)/gm, "`$1`");
        return d.indexOf("\n") === -1 ? d : d.replace(/^/gm, "> ");
        //return d.indexOf("\n") === -1 ? d : "```markdown\n"+ d + "\n```\n";
    }
    for (let k in v) {
        ret += `${head} ${k}
${modMd(v[k], head + "#")}
`;
    }
    return ret;
}

async function newMd(ch, file) {
    const f = await readAA(file);

    //console.log(f)
    fs.rmdirSync(path.resolve(__dirname, './dist').toString(), {recursive: true});
    const gen = new Generator('@asyncapi/markdown-template', __dirname + '/dist');
    for (let k in f._json.channels) {
        if (ch[k] === undefined) {
            delete f._json.channels[k];
        }
    }
    // console.log(f)
    //const x = new parser.AsyncAPIDocument();
    //f.prototype = parser.AsyncAPIDocument;
    await gen.generate(f);
    const r = fs.readFileSync(path.resolve(__dirname, './dist/asyncapi.md')).toString().split("## Channels")[1];

    return r.replace(/^## /gm, "##### ");
}

async function outMd(res, fmt) {
    let out = "# Summary\n";
    out += "# Removed\n";
    for (let key in res["deleted"]) {
        out += `## ${res["deleted"][key]}\n`;
    }
    out += "# Modified\n";
    out += modMd(res["modified"]);

    out += "# New\n";
    out += "**Summary**  \n";
    for (let key in res["new"]) {
        out += `- ${res["new"][key]}\n`;
    }
    const x = await newMd(res.new, f2);
    out += x;
    out = out.replace(/<ins>/gm, "<ins style=\"color:red\">")
    out = out.replace(/<del>/gm, "<del style=\"color:red\">")
    out = out.replace(/^####### /gm, "- ")
    out = out.replace(/\|\-/g, "|---")
    out = out.replace(/^######## /gm, "  - ")
    out = out.replace(/^######### /gm, "     - ")
    out = out.replace(/^########## /gm, "        - ")
    out = out.replace(/^########### /gm, "           - ")

    var remark = require('remark')
    var toc = require('remark-toc')
    remark()
      .use(toc, {"maxDepth": 3, heading: 'Summary'})
      .process(out, function(err, file) {
        if (err) throw err
          if( fmt === "html" ){
              const marked = require("marked");
              console.log(marked(String(file)))
          } else {
              console.log(String(file))
          }
      })
    //console.log(out);
}

if (f1 && f2) {
    const res = diff(f1, f2).then(res => {
        switch (fmt) {
            case "json":
                res.modified = flattenObject(res.modified)
                console.log(JSON.stringify(res, null, 2));
                break;
            case "md":
                outMd(res);

                break;
            case "html":
                outMd(res, "html");
                break;
            default:
                console.error("format not supported");
        }
    });
} else {
    console.log("aadiff oldFile newFile [format]")
}

