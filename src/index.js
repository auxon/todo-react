import React from 'react'
import ReactDOM from 'react-dom'
import Prompt from '@babbage/react-prompt'
import App from './App'

ReactDOM.render(
  <Prompt
    customPrompt
    appName='inventStore'
    appIcon='/favicon.ico'
    author='RAH@entangleIT.com'
    authorUrl='https://EntangleIT.com'
    description='Personal and Private Inventory Management running on Bitcoin'
    supportedMetaNet='universal' // 'universal' is the default (app works on both Mainnet & Testnet) or value can be just 'mainnet' or 'testnet'
    nativeAppUrls= {{
      iOS: {
        mainnet: 'https://youriOSappMainnetlink.com',
        testnet: 'https://youriOSappTestnetlink.com'
      },
      Android: {
        mainnet: 'https://yourAndroidappMainnetlink.com',
        testnet: 'https://yourAndroidappTestnetlink.com'
      }
    }}
  >
    <App />
  </Prompt>,
  document.getElementById('root')
)
