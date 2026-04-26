import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";
import { Switch } from "@/components/ui/switch"; 
import { Label } from "@/components/ui/label";

// Note: You must pass your instantiated hook object as a prop if you already called useLiveKitRoom() in a parent component.
// Example usage: <InterviewModeToggle liveKit={yourLiveKitHookData} />

export function InterviewModeToggle({ liveKit }: { liveKit: ReturnType<typeof useLiveKitRoom> }) {
  return (
    <div className="flex items-center space-x-3 p-4 bg-gray-50 border rounded-md">
      <Switch 
        id="interview-mode" 
        checked={liveKit.interviewMode} 
        onCheckedChange={liveKit.toggleInterviewMode} 
      />
      <div className="flex flex-col">
        <Label htmlFor="interview-mode" className="text-sm font-semibold">
          Interview Mode
        </Label>
        <span className="text-xs text-gray-500">
          {liveKit.interviewMode ? "Voice alerts ON" : "Voice alerts OFF (Muted)"}
        </span>
      </div>
    </div>
  );
}