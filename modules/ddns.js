const superagent = require('superagent');
var os = require('os');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const eol = os.EOL;

var spawnedTunnel;
const apiEndpoint = 'https://api.mstream.io';
const platform = os.platform();
const osMap = {
  "win32": "mstream-ddns-win.exe",
  "darwin": "mstream-ddns-osx",
  "linux": "mstream-ddns-linux"
};

exports.setup = function (program) {
  process.on('exit', (code) => {
    // kill all workers
    if(spawnedTunnel) {
      spawnedTunnel.stdin.pause();
      spawnedTunnel.kill();
    }
  });

  if(!program.ddns || !program.ddns.email || !program.ddns.password) {
    return;
  }

  login(program);
}

async function login(program) {
  var info;
  try {
    // login
    const loginRes = await superagent.post(apiEndpoint + '/login').set('accept', 'json').send({
      email: program.ddns.email,
      password: program.ddns.password
    });

    // pull in config options
    const configRes = await superagent.get(apiEndpoint + '/account/info').set('x-access-token', loginRes.body.token).set('accept', 'json');
    info = configRes.body;
  } catch (err) {
    winston.error('Login to Auto DNS Failed');
    winston.error(err.message);
    return;
  }

  // write config file for FRP
  try{
    const iniString = `[common]${eol}server_addr = ${info.ddnsAddress}${eol}server_port = ${info.ddnsPort}${eol}token = ${info.ddnsPassword}${eol}${eol}[web]${eol}type = http${eol}local_ip = 127.0.0.1${eol}custom_domains = ${info.subdomain}.${info.domain}${eol}local_port = ${program.port}`;
    fs.writeFileSync(program.ddns.iniFile, iniString);
  } catch(err) {
    winston.error('Failed to write FRP ini');
    winston.error(err.message);
    return;
  }

  // Boot it
  bootReverseProxy(program, info);
}

function bootReverseProxy(program, info) {
  if(spawnedTunnel) {
    winston.warn('Auto DNS: Tunnel already setup');    
  }

  try {
    spawnedTunnel = spawn(path.join(__dirname, `../frp/${osMap[platform]}`), ['-c', program.ddns.iniFile], {
      // shell: true,
      // cwd: path.join(__dirname, `../frp/`),
      stdio: 'ignore'
    });

    spawnedTunnel.on('close', (code) => {
      winston.info('Auto DNS: Tunnel Closed. Attempting to reboot');
      setTimeout(() => { 
        winston.info('Auto DNS: Rebooting Tunnel');
        delete spawnedTunnel;
        bootReverseProxy(program, info);
      }, 4000);
    });

    winston.info('Auto DNS: Secure Tunnel Established');
    winston.info(`Access Your Server At: https://${info.subdomain}.${info.domain}`);
  }catch (err) {
    winston.error(`Failed to boot FRP`);
    winston.error(err.message);
    return;
  }
}