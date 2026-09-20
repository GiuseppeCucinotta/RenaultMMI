# Trip computer
The following app is a glorified trip computer. This spec explain what it should do.

## Frontend

- Users is allowed to select a time period in order to see consumption data, more particular:
    - they can see how much money they spent on gas during that period
    - how many liters they have consumed
    - their avg. consumption (expressed in km/l or l/100, selectable from the system settings)
    - how much km did they in that period

Every of this data will be in a card and there should also be a system that calculates a "trend". If in a period (for example of two weeks) the user has travelled more, then it will appear on the card an arrow up (this is the asset: ) with a text on the bottom of the card that says like "+2l than last period". Finally, there must be a graph that show all this data. If there's no data, well the frontend should output no data (-- in cards, for example).

Here's the photo of the design I did: @./Trip Computer.png

## Backend

- Log the data from the vehicle UDP packets that arrives for the consumpion.
- Stores this data in the most simple database which has to be fast and put near-zero overhead to the system. (For dev purpose, we have to containerize it; on the production system, we have it exposed without any container that add overhead).
- Build the most fastest and light weight backend that can calculate this data from the DB and send them to the frontend Trip Computer app. Let's value different languages together; idk if I want to have all in TS or this project can use other languages. My dream would be to use C whenever it's possible. Help me making this choice when you make the Q&A on this part: give me different options because I geniuly don't know what is better to do, to use only TS or other things
- Since it's a trip computer, the settings must be in the Vehicle section of the Settings app. You must add settings for this app there.
- The backend should understand if the fuel level of the car changed significantly, for example it grew for more then 2 liters and ask the user on the startup via a global notification (that should live in the entirety app) at what price per liter it did the fueling. Spec this feature into another spec so another subagent can implement it. A global notification service that can be used by every app through the whole system.  

Warning: this backend should be implemented together with @../trip-history, read also that spec to understand how it should implemented. This backend should manage both apps. 

## Tests

The frontend app in the Electron should only render data and should not do any calculation. That's what the backend should do. Because we won't have any real data, just create a mock that works only in dev mode. I will have to do tests in the future to see if the data from the car is readable, so put a switch in the app somewhere visible only in dev mode to deactivate the mock data.

You have to test the trip computer calculus in different periods to see if the data are coherent.

