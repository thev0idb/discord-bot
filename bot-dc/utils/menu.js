
const fs = require('node:fs');
const path = require('node:path');
const { ownerId } = require('../config');

const filePath = path.join(__dirname, '..', 'bot-admins.json');

function loadAdmins() {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let admins = loadAdmins();

function saveAdmins() {
  fs.writeFileSync(filePath, JSON.stringify(admins, null, 2));
}

function isAdmin(userId) {
  return userId === ownerId || admins.includes(userId);
}

function addAdmin(userId) {
  if (userId === ownerId || admins.includes(userId)) return false;
  admins.push(userId);
  saveAdmins();
  return true;
}

function removeAdmin(userId) {
  if (!admins.includes(userId)) return false;
  admins = admins.filter(id => id !== userId);
  saveAdmins();
  return true;
}

function getAdmins() {
  return [...admins];
}

module.exports = {
  isAdmin,
  addAdmin,
  removeAdmin,
  getAdmins,
};
