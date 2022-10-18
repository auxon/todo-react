/**
 * src/App.js
 * 
 * This file contains the primary business logic and UI code for the ToDo 
 * application.
 */
import React, { useState, useEffect } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import {
  AppBar, Toolbar, List, ListItem, ListItemText, ListItemIcon, Checkbox, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, TextField,
  Button, Fab, LinearProgress, Typography
} from '@mui/material'
import { makeStyles } from '@mui/styles'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import parapet from 'parapet-js'
import pushdrop from 'pushdrop'
import { getPublicKey, decrypt, encrypt, createAction } from '@babbage/sdk'

// Determine which Bridgeport environment this app is running in.
// In local development mode, the app talks to the local Connecticut proxy.
// When the app's website URL contains "staging", the app runs on Stgeline.
// Otherwise, the app will run in Mainline (production) mode, with real Bitcoin.
const bridgeportResolvers = window.location.host.startsWith('localhost')
  ? ['http://localhost:3103']
  : window.location.host.startsWith('staging')
    ? ['https://staging-bridgeport.babbage.systems']
    : undefined // In production, Parapet defaults to the correct resolvers

// This is the namespace address for the ToDo protocol
// You can create your own Bitcoin address to use, and customize this protocol
// for your own needs.
const TODO_PROTO_ADDR = '1ToDoDtKreEzbHYKFjmoBuduFmSXXUGZG'

// These are some basic styling rules for the React application.
// This app uses React (https://reactjs.org) for its user interface.
// We are also using MUI (https://mui.com) for buttons and dialogs.
// This stylesheet uses a language called JSS.
const useStyles = makeStyles({
  app_bar_placeholder: {
    height: '4em'
  },
  add_fab: {
    position: 'fixed',
    right: '1em',
    bottom: '1em'
  },
  loading_bar: {
    margin: '1em'
  }
}, { name: 'App' })

const App = () => {
  // These are some state variables that control the app's interface.
  const [createOpen, setCreateOpen] = useState(false)
  const [createTask, setCreateTask] = useState('')
  const [createAmount, setCreateAmount] = useState(1000)
  const [createLoading, setCreateLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasks, setTasks] = useState([])
  const [completeOpen, setCompleteOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState({})
  const [completeLoading, setCompleteLoading] = useState(false)
  const classes = useStyles()

  // This loads a user's existing ToDo tokens from the app's ToDo token bridge 
  // whenever the page loads. This populates their ToDo list.
  // A bridge is just a way to parse and track different Bitcoin tokens.
  useEffect(() => {
    (async () => {
      try {
        // Finds the current user's ToDo List protocol public key
        // Users can have different public keys for various different
        // protocols, which are contexts where their data is stored.
        // This simple "todo list" protocol always uses a key ID of "1", but 
        // other protocols can use different key IDs for better privacy.
        const userPublicKey = await getPublicKey({
          protocolID: 'todo list',
          keyID: '1'
        })

        // Now we'll use a tool called Parapet to fetch this user's current 
        // ToDo tokens from the ToDo bridge. Tokens are just a way to represent 
        // something of value, like a task that needs to be completed.
        const tasksFromBridge = await parapet({
          resolvers: bridgeportResolvers,
          bridge: TODO_PROTO_ADDR,
          request: {
            type: 'json-query',
            query: {
              v: 3,
              q: {
                collection: 'todo',
                find: {
                  user: userPublicKey
                }
              }
            }
          }
        })

        // Now that we have the data, we will decrypt the tasks from the bridge.
        // The tasks were stored on Bitcoin publicly, but they were encrypted 
        // so that only this user could read them.
        const decryptedTasks = await Promise
          .all(tasksFromBridge.map(async task => {
            try {
              // We'll pass in the encrypted value from the token payload, and 
              // use the same "todo list" protocol and key ID for decrypting.
              const decryptedTask = await decrypt({
                ciphertext: Buffer.from(task.task, 'base64'),
                protocolID: 'todo list',
                keyID: '1',
                returnType: 'string'
              })
              return {
                ...task,
                task: decryptedTask
              }
            } catch (e) {
              // In case there are any errors, we'll handle them gracefully.
              console.error('Error decrypting task:', e)
              return {
                ...task,
                task: '[error] Unable to decrypt task!'
              }
            }
          }))
        
        // We reverse the list, so the newest tasks show up at the top
        setTasks(decryptedTasks.reverse())
      } catch (e) {
        // Any larger errors are also handled. If these steps fail, maybe the 
        // useer didn't give our app the right permissions, and we couldn't use 
        // the "todo list" protocol.
        toast.error(`Failed to load ToDo tasks! Does the app have permission? Error: ${e.message}`)
        console.error(e)
      } finally {
        setTasksLoading(false)
      }
    })()
  }, [])

  // Creates a new ToDo token.
  // This function will run when the user clicks "OK" in the creation dialog.
  const handleCreateSubmit = async e => {
    e.preventDefault() // Stop the HTML form from reloading the page.
    try {
      // Here, we handle some basic mistakes the user might have made.
      if (!createTask) {
        toast.error('Enter a task to complete!')
        return
      }
      if (!createAmount) {
        toast.error('Enter an amount for the new task!')
        return
      }
      if (Number(createAmount) < 500) {
        toast.error('The amount must be more than 200 satoshis!')
        return
      }
      // Now, we start a loading bar before the encryption and heavy lifting.
      setCreateLoading(true)

      // We can take the user's input from the text field (their new task), and 
      // encrypt it with a key that only they have.When we put the encrypted 
      // value into a ToDo Bitcoin token, only the same user can get it back 
      // later on, after creation.
      const encryptedTask = await encrypt({
        plaintext: Uint8Array.from(Buffer.from(createTask)),
        protocolID: 'todo list',
        keyID: '1'
      })

      // Here's the part where we create the new Bitcoin token.
      // This uses a library called PushDrop, which lets you attach data 
      // payloads to Bitcoin token outputs.Then, you can redeem / unlock the 
      // tokens later.
      const bitcoinOutputScript = await pushdrop.create({
        fields: [ // The "fields" are the data payload to attach to the token.
          // For more info on these fields, look at the ToDo protocol document.
          Buffer.from(TODO_PROTO_ADDR), // TODO protocol namespace address
          Buffer.from(encryptedTask)    // TODO task (encrypted)
        ],
        // The same "todo list" protocol and key ID can be used to sign and 
        // lock this new Bitcoin PushDrop token.
        protocolID: 'todo list',
        keyID: '1'
      })

      // Now that we have the output script for our ToDo Bitcoin token, we can 
      // add it to a Bitcoin transaction (a.k.a. "Action"), and send it to the 
      // blockchain. Actions are the things that users do, and they take the 
      // form of Bitcoin transactions.
      const newToDoToken = await createAction({
        // The Bitcoin transaction ("Action" with a capital A) has an output, 
        // because it has led to the creation of a new Bitcoin token.The token 
        // that gets created represents our new ToDo list item.
        outputs: [{
          // The output amount is how much Bitcoin (measured in "satoshis") 
          // this token is worth. We use the value that the user entered in the 
          // dialog box.
          satoshis: Number(createAmount),
          // The output script for this token was created by PushDrop library, 
          // which you can see above.
          script: bitcoinOutputScript
        }],
        // We'll let the user know what this Action
        description: `Create a TODO task: ${createTask}`,
        // We'll send this Action to the ToDo bridge, so that a system called 
        // Bridgeport can keep track of it. That way, the user can always get 
        // all their ToDo token back when they reload the page.
        bridges: [TODO_PROTO_ADDR]
      })

      // Now, we just let the user know the good news! Their token has been 
      // created, and added to the list.
      toast.dark('Task successfully created!')
      setTasks(originalTasks => ([
        {
          task: createTask,
          sats: Number(createAmount),
          token: {
            ...newToDoToken,
            lockingScript: bitcoinOutputScript,
            outputIndex: 0
          }
        },
        ...originalTasks
      ]))
      setCreateTask('')
      setCreateAmount(1000)
      setCreateOpen(false)
    } catch (e) {
      // Any errors are shown on the screen and printed in the developer console
      toast.error(e.message)
      console.error(e)
    } finally {
      setCreateLoading(false)
    }
  }

  // Opens the completion dialog for the selected task
  const openCompleteModal = task => () => {
    setSelectedTask(task)
    setCompleteOpen(true)
  }

  // Redeems the ToDo toeken, marking the selected task as completed.
  // This function runs when the user clicks the "complete" button on the 
  // completion dialog.
  const handleCompleteSubmit = async e => {
    e.preventDefault() // Stop the HTML form from reloading the page.
    try {
      // Start a loading bar to let the user know we're working on it.
      setCompleteLoading(true)

      // Here, we're using the PushDrop library to unlcok / redeem the PushDrop 
      // token that was previously created.By providing this information, 
      // PushDrop can "unlock" and spend the token.When the token gets spent, 
      // the user gets their bitcoins back, and the ToDo token is removed from 
      // the list.
      const unlockingScript = await pushdrop.redeem({
        // To unlock the token, we need to use the same "todo list" protocol 
        // and key ID as when we created the ToDo token before.Otherwise, the 
        // key won't fit the lock and the Bitcoins won't come out.
        protocolID: 'todo list',
        keyID: '1',
        // We're telling PushDrop which previous transaction and output we want to unlock, so that the correct unlocking puzzle can be prepared.
        prevTxId: selectedTask.token.txid,
        outputIndex: selectedTask.token.outputIndex,
        // We also give PushDrop a copy of the locking puzzle ("script") that 
        // we want to open, which is helpful in preparing to unlock it.
        lockingScript: selectedTask.token.lockingScript,
        // Finally, the amount of Bitcoins we are expecting to unlock when the 
        // puzzle gets solved.
        outputAmount: selectedTask.sats
      })

      // Now, we're going to use the unlocking puzle that PushDrop has prepared for us, so that the user can get their Bitcoins back. This is another "Action", which is just a Bitcoin transaction.
      await createAction({
        // Let the user know what's going on, and why they're getting some 
        // Bitcoins back.
        description: `Complete a TODO task: "${selectedTask.task}"`,
        inputs: { // These are inputs, which unlock Bitcoin tokens.
          // The input comes from the ToDo token which we're completing
          [selectedTask.token.txid]: {
            ...selectedTask.token,
            // The output we want to redeem is specified here, and we also give 
            // the unlocking puzzle ("script") from PushDrop.
            outputsToRedeem: [{
              index: selectedTask.token.outputIndex,
              unlockingScript
            }]
          }
        },
        // We let the ToDo token bridge know that this token has been spent, so 
        // that it can be removed from the list.
        bridges: [TODO_PROTO_ADDR]
      })
      // Finally, we let the user know about the good news, and that their  
      // completed ToDo token has been removed from their list! The satoshis 
      // have now been unlocked, and are back in their posession.
      toast.dark('Congrats! Task complete🎉')
      setTasks(oldTasks => {
        oldTasks.splice(oldTasks.findIndex(x => x === selectedTask), 1)
        return oldTasks
      })
      setSelectedTask({})
      setCompleteOpen(false)
    } catch (e) {
      toast.error(`Error completing task: ${e.message}`)
      console.error(e)
    } finally {
      setCompleteLoading(false)
    }
  }

  // The rest of this file just contains some UI code. All the juicy 
  // Bitcoin - related stuff is above.

  return (
    <>
      {/* This shows the user success messages and errors */}
      <ToastContainer />

      {/* here's the app title bar */}
      <AppBar>
        <Toolbar>
          <Typography>ToDo List — Get Rewarded!</Typography>
        </Toolbar>
      </AppBar>
      <div className={classes.app_bar_placeholder} />

      {/* Here's the plus button that hangs out at the bottom-right */}
      <div className={classes.add_fab}>
        <Fab color='secondary' onClick={() => setCreateOpen(true)}>
          <AddIcon />
        </Fab>
      </div>

      {/* This bit shows a loading bar, or the list of tasks */}
      {tasksLoading
        ? <LinearProgress className={classes.loading_bar} />
        : (
          <List>
            {tasks.map((x, i) => (
              <ListItem
                key={i}
                button
                onClick={openCompleteModal(x)}
              >
                <ListItemIcon><Checkbox checked={false} /></ListItemIcon>
                <ListItemText
                  primary={x.task}
                  secondary={`${x.sats} satoshis`}
                />
              </ListItem>
            ))}
          </List>
        )}

      {/* This is the dialog for creating a new task */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreateSubmit}>
          <DialogTitle>
            Create a Task
          </DialogTitle>
          <DialogContent>
            <DialogContentText paragraph>
              Describe your task and set aside some satoshis you'll get back once
              it's done.
            </DialogContentText>
            <TextField
              multiline rows={3} fullWidth autoFocus
              label='Task to complete'
              onChange={e => setCreateTask(e.target.value)}
              value={createTask}
            />
            <br />
            <br />
            <TextField
              fullWidth type='number' min={100}
              label='Completion amount'
              onChange={e => setCreateAmount(e.target.value)}
              value={createAmount}
            />
          </DialogContent>
          {createLoading
            ? <LinearProgress className={classes.loading_bar} />
            : (
            <DialogActions>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type='submit'>OK</Button>
            </DialogActions>
          )}
        </form>
      </Dialog>

      {/* Finally, this is the dialog for completing a ToDo task */}
      <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)}>
        <form onSubmit={handleCompleteSubmit}>
          <DialogTitle>
            Complete "{selectedTask.task}"?
          </DialogTitle>
          <DialogContent>
            <DialogContentText paragraph>
              By marking this task as complete, you'll receive back your {selectedTask.sats} satoshis.
            </DialogContentText>
          </DialogContent>
          {completeLoading
            ? <LinearProgress className={classes.loading_bar} />
            : (
            <DialogActions>
              <Button onClick={() => setCompleteOpen(false)}>Cancel</Button>
              <Button type='submit'>Complete Task</Button>
            </DialogActions>
          )}
        </form>
      </Dialog>
    </>
  )
}

export default App
