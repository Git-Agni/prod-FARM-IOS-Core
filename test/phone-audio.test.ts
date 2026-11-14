import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedPhoneMute, silenceConfirmationMatches, type PhoneAudioStatus } from '../src/devices/mirroring/audio.js';
const safe = { ready: true, scope: 'iphone_mirroring_only', targetBundle: 'com.apple.ScreenContinuity', audioRecorded: false, masterVolumeChanged: false,
    bindingVerified:true,audibilityVerified:true,targetProcessIds:[209],
    muteArmed:true,aggregateId:213,physicalOutputDevices:0,audioIOStarted:false,
    verificationMethod:'owner_playback_report',silenceConfirmedAt:'2026-10-05T20:00:00Z' };
test('only verified Mirroring-only mute is accepted', () => {
    assert.equal(verifiedPhoneMute(safe), true);
    for (const invalid of [null, {}, {...safe, ready:false}, {...safe, scope:'all_apps'}, {...safe, targetBundle:'com.apple.Safari'}, {...safe, audioRecorded:true}, {...safe, masterVolumeChanged:true}])
        assert.equal(verifiedPhoneMute(invalid), false);
});
test('owner silence reports bind to the current helper generation and exact live route',()=>{
    const current={...safe,ready:false,audibilityVerified:false,tapId:212,
        serviceGeneration:'7ad49d68-c9af-4e94-95fb-3578d7a72059',reason:'Needs owner check'} as PhoneAudioStatus;
    const report={confirmation:'owner_confirmed_silent_playback',serviceGeneration:current.serviceGeneration,
        tapId:212,aggregateId:213,targetProcessIds:[209]};
    assert.equal(silenceConfirmationMatches(report,current),true);
    for(const bad of [null,{}, {...report,confirmation:'simulated_test'},
        {...report,serviceGeneration:'other-generation'},{...report,tapId:211},
        {...report,aggregateId:210},{...report,targetProcessIds:[208]},
        {...report,targetProcessIds:[209,209]}])assert.equal(silenceConfirmationMatches(bad,current),false);
    for(const bad of [{...current,bindingVerified:false},{...current,physicalOutputDevices:1},
        {...current,audioIOStarted:true},{...current,audioRecorded:true},
        {...current,masterVolumeChanged:true},{...current,targetBundle:'com.apple.Safari'},
        {...current,targetProcessIds:[]}])assert.equal(silenceConfirmationMatches(report,bad as PhoneAudioStatus),false);
});
test('mute admission requires the private sink without hardware outputs or audio reads',()=>{
    for(const value of [{...safe,muteArmed:false},{...safe,aggregateId:undefined},
        {...safe,aggregateId:0},{...safe,physicalOutputDevices:1},{...safe,audioIOStarted:true}])
        assert.equal(verifiedPhoneMute(value),false);
});
test('configured mute without audibility and current process binding cannot admit playback',()=>{
    for(const value of [{...safe,audibilityVerified:false},{...safe,bindingVerified:false},
        {...safe,targetProcessIds:[]},{...safe,targetProcessIds:[0]}, {...safe,targetProcessIds:[209,209]},
        {ready:true,scope:'iphone_mirroring_only',targetBundle:'com.apple.ScreenContinuity',audioRecorded:false,masterVolumeChanged:false}])
        assert.equal(verifiedPhoneMute(value),false);
});
test('system mute needs a current generation and an exact process event, without a fake owner report',()=>{
    const value={...safe,verificationMethod:'coreaudio_process_muter',silenceConfirmedAt:null,
        serviceGeneration:'7ad49d68-c9af-4e94-95fb-3578d7a72059',systemMuteVerifiedAt:'2026-10-05T20:00:00Z',targetPIDs:[123]};
    assert.equal(verifiedPhoneMute(value),true);
    for(const bad of [{...value,verificationMethod:'none'},{...value,systemMuteVerifiedAt:null},
        {...value,systemMuteVerifiedAt:'bad'},{...value,serviceGeneration:'old'},
        {...value,targetPIDs:[]},{...value,targetPIDs:[0]},{...value,targetPIDs:[123,124]}])
        assert.equal(verifiedPhoneMute(bad),false);
});
