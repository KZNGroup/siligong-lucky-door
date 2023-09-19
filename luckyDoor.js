#!/usr/bin/env node
import _ from "lodash";
import fetch from "node-fetch";
import clear from "clear";
import * as terminalImage from "terminal-image";
import { produce } from "immer";

// If downloading images goes terribly wrong then set this to false
// for a text-only mode:
const SHOW_IMAGES = true;

const DEFAULT_MAX_SPIN_TIME = 120000;

main({
  //   maxEntrees: 20,
  rumRounds: 1,
  intervalInMs: 150,
  //   maxSpinTimeInMs: 10000,
  maxReRollTimeInMs: 2000,
});

async function main({
  maxEntrees = 0,
  rumRounds = 2,
  intervalInMs = 80,
  maxSpinTimeInMs = DEFAULT_MAX_SPIN_TIME,
  maxReRollTimeInMs = DEFAULT_MAX_SPIN_TIME,
}) {
  await showMaxEntreesWarning(maxEntrees);

  let profiles = await getAllProfiles(maxEntrees);

  while (true) {
    await doWelcome(profiles.length);

    // The winner should always be the last one in the (randomised) list,
    // unless it would take longer than maxSpinTimeInMs, or we are going
    // to allow less time because we're re-rolling a new winner.
    let spinTimeInMs = intervalInMs * (profiles.length - 1) * rumRounds;
    if (spinTimeInMs > maxSpinTimeInMs) {
      spinTimeInMs = maxSpinTimeInMs;
    }
    const winner = await selectWinner(profiles, spinTimeInMs, intervalInMs);

    showProfile(winner);

    if (await shouldContinue()) {
      console.log(`Removing ${winner.name} and rolling a new winner...`);
      rumRounds = 1;
      profiles = _.filter(profiles, (p) => p.id !== winner.id);
      profiles = _.shuffle(profiles);

      // Ensure re-rolls due to non-attendance don't take too long:
      maxSpinTimeInMs = maxReRollTimeInMs;
      await sleep(2000);
    } else {
      process.exit(0);
    }
  }
}

async function getAllProfiles(max) {
  console.log(`Getting list of attendees...`);
  const response = await fetch(
    "https://api.meetup.com/amazon-web-services-user-group/events/295752887/rsvps?photo-host=public&response=yes"
  );
  let allRsvps = await response.json();

  let withoutOrganizers = _.filter(allRsvps, (rsvp) => {
    if (rsvp["member"]["is_organizer"] === true) {
      console.log(`Removing organizer: ${rsvp["member"]["name"]}`);
      return false;
    }
    return true;
  }).slice(0, max - 1);
  const numOrganizers = allRsvps.length - withoutOrganizers.length;
  console.log(`Removed ${numOrganizers} event organizers from the entry pool.`);

  // Note: this is apparantly an unbiased random shuffle, so we don't need to
  // do anything else special to randomise the result:
  const randomised = await Promise.all(
    _.shuffle(withoutOrganizers).map(getProfile)
  );
  return randomised;
}

async function selectWinner(profiles, spinTimeInMs, intervalInMs) {
  const now = Date.now();
  let i = 0;
  let currentProfile;
  while (Date.now() < now + spinTimeInMs) {
    currentProfile = profiles[i];
    showProfile(currentProfile);
    await sleep(intervalInMs);
    i++;
    if (i >= profiles.length) {
      i = 0;
      // Shuffle profiles after each complete round just so it looks more random
      // to people watching the sequence of profile photos being shown.
      // (even though the result would still be random if we went through them
      // in the same order again)
      profiles = _.shuffle(profiles);
    }
  }

  const winner = produce(currentProfile, (profile) => {
    profile.isWinner = true;
  });
  return winner;
}

async function getProfile({ member: { name, photo, id, is_organizer } }) {
  return produce({ name, photo, id, is_organizer }, async (profile) => {
    const imageUrl =
      photo && photo.photo_link
        ? photo.photo_link
        : "https://cdn.vectorstock.com/i/preview-1x/82/99/no-image-available-like-missing-picture-vector-43938299.jpg";
    const imgResponse = await fetch(imageUrl);
    if (!name) {
      profile.name = "Unknown person with no name";
    }
    if (SHOW_IMAGES) {
      profile.image = await terminalImage.buffer(await imgResponse.buffer(), {
        height: "60%",
      });
    }
    delete profile.photo;
  });
}

function showProfile({ name, image, isWinner = false }) {
  SHOW_IMAGES && clear();
  console.log();
  SHOW_IMAGES && console.log(image);
  if (isWinner) {
    console.error(`THE WINNER IS: ${name}!!!!!!!!!!!!!11111one`);
  } else {
    console.log(name);
  }
}

async function doWelcome(length) {
  clear();
  console.log("Lucky Door prize generator");
  console.log(`Picking a winner out of ${length} attendees...`);
  await sleep(1000);
}

const sleep = (x) => new Promise((resolve) => setTimeout(() => resolve(), x));

async function shouldContinue() {
  const input = await new Promise((resolve) =>
    process.stdin.once("data", resolve)
  );
  if (input.toString().trim() === "q") {
    return 0;
  }
  return 1;
}

async function showMaxEntreesWarning(maxEntrees) {
  if (maxEntrees && maxEntrees > 0) {
    console.warn(
      "Warning: running in limited entrees mode, this is meant for testing only!"
    );
    console.warn(`Only ${maxEntrees} entrees will be used`);
    console.warn("Press Enter to proceed anyway....");
    if (await shouldContinue()) {
      return;
    } else {
      process.exit(0);
    }
  }
}
